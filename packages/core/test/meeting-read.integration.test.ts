/** #2038: durable mark-read, one transactional event, races, rollback, and Health replay. */
import { createIdGenerator, type MeetingId, type MessageId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaClient, createPrismaClientTellingStatements } from '../src/adapters/prisma/client.js';
import { createPrismaDeliveryRepository } from '../src/adapters/prisma/messaging.js';
import { createPrismaHealthRecords } from '../src/adapters/prisma/health.js';
import { createPrismaHealthSnapshots } from '../src/adapters/prisma/health-snapshots.js';
import { createPrismaUnitOfWork } from '../src/adapters/prisma/unit-of-work.js';
import { createAcknowledgeMeetingUpTo } from '../src/domain/messaging/acknowledge-meeting-up-to.js';
import { createUseCases } from '../src/wiring.js';
import { newKey } from '../src/testing/keys.js';
import { unwrap } from '../src/testing/result.js';
import type { Crew, ShipCaller } from '../src/domain/shared/caller.js';
import { operatorCaller, secretOf } from './support/core-fixtures.js';
import { assertIndexedPlan } from './support/assert-indexed-plan.js';
import { withOperatorLogin } from './support/operator-login.js';
import { createPostgresCore, racingUnitOfWork, type PostgresCore } from './support/postgres-core.js';

const ids = createIdGenerator();
const MODEL = 'gpt-6.1-sol';
let core: PostgresCore;
let chief: Crew;
let reader: Crew;
let meetingId: MeetingId;

async function crewed(argo: ShipCaller, name: string): Promise<Crew> {
  const { shipId, secret } = unwrap(await core.useCases.commissionShip(argo, { name, type: 'agent', idempotencyKey: newKey() }));
  const { crewToken } = unwrap(await core.useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'CLOUD' }, harness: 'codex' }));
  return unwrap(await core.useCases.authenticate.byCrewToken(crewToken));
}
beforeEach(async () => {
  core = await createPostgresCore();
  const argo = operatorCaller(unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'Meeting read' }))));
  chief = await crewed(argo, 'chief');
  reader = await crewed(argo, 'reader');
  ({ meetingId } = unwrap(await core.useCases.openMeeting(chief, { ships: [{ shipId: reader.shipId }], idempotencyKey: newKey(), model: MODEL })));
});
afterEach(async () => { await core.close(); });
async function contribute(): Promise<MessageId> {
  core.clock.advance(1_000);
  return unwrap(await core.useCases.sendMessage(chief, { selector: { kind: 'meeting', meetingId }, payload: 'Discussed', idempotencyKey: newKey(), model: MODEL })).messageId;
}
async function states() {
  return core.prisma.delivery.findMany({ where: { fleetId: reader.fleetId, recipientShipId: reader.shipId }, orderBy: { id: 'asc' }, select: { state: true } });
}

describe('marking meeting contributions read on Postgres', () => {
  it('persists one bulk event and the acknowledged deliveries across a server restart, preserving notices and newer contributions', async () => {
    // Given two contributions before the cutoff and one after it.
    await contribute();
    const upTo = await contribute();
    await contribute();
    const events = await core.prisma.event.count();

    // When the reader marks through the second contribution and the server restarts.
    expect(unwrap(await core.useCases.acknowledgeMeetingUpTo(reader, { meetingId, messageId: upTo }))).toEqual({ acknowledged: 2 });
    const restarted = createPrismaClient(core.databaseUrl);
    try {
      const useCases = createUseCases({ prisma: restarted, clock: core.clock });
      expect(unwrap(await useCases.acknowledgeMeetingUpTo(reader, { meetingId, messageId: upTo }))).toEqual({ acknowledged: 0 });

      // Then the read and repeat survive, with one event total and both the added notice and newer contribution still pending.
      expect(await states()).toEqual([{ state: 'pending' }, { state: 'acknowledged' }, { state: 'acknowledged' }, { state: 'pending' }]);
      expect(await restarted.event.count()).toBe(events + 1);
      expect(await restarted.event.findMany({ where: { type: 'MeetingReadUpTo' } })).toMatchObject([{ shipId: reader.shipId, messageId: upTo, details: { meetingId, acknowledged: 2, leaseId: reader.leaseId } }]);
    } finally { await restarted.$disconnect(); }
  });

  it('rolls back all acknowledgements when writing their single event fails', async () => {
    // Given two pending contribution deliveries and a failure at their event write.
    await contribute();
    const upTo = await contribute();
    const before = await core.prisma.event.count();
    const uow = createPrismaUnitOfWork(core.prisma);
    const failing = createAcknowledgeMeetingUpTo({ clock: core.clock, ids, uow: { run: (work) => uow.run((tx) => work({ ...tx, events: { append: () => { throw new Error('event write failed'); } } })) } });

    // When the read cannot commit its event.
    await expect(failing(reader, { meetingId, messageId: upTo })).rejects.toThrow('event write failed');

    // Then no delivery or event changed.
    expect(await states()).toEqual([{ state: 'pending' }, { state: 'pending' }, { state: 'pending' }]);
    expect(await core.prisma.event.count()).toBe(before);
  });

  it('two simultaneous marks acknowledge each pending contribution once with one event between them', async () => {
    // Given two contributions and two transactions held where the first updates its deliveries.
    await contribute();
    const upTo = await contribute();
    const uow = racingUnitOfWork({ prisma: core.prisma, transactions: 2 }, (tx, allArrived) => ({ ...tx, deliveries: { ...tx.deliveries, acknowledgeMeetingContributionsUpTo: async (input) => { const count = await tx.deliveries.acknowledgeMeetingContributionsUpTo(input); await allArrived(); return count; } } }));
    const mark = createAcknowledgeMeetingUpTo({ uow, clock: core.clock, ids });

    // When both places mark through the same contribution together.
    const results = await Promise.all([mark(reader, { meetingId, messageId: upTo }), mark(reader, { meetingId, messageId: upTo })]);

    // Then the combined acknowledgement is two, with one durable event.
    expect(results.map(unwrap).map((result) => result.acknowledged).toSorted()).toEqual([0, 2]);
    expect(await core.prisma.event.count({ where: { type: 'MeetingReadUpTo' } })).toBe(1);
  });

  it('counts bulk acknowledgements in Health records, first snapshot bootstrap and later snapshot replay', async () => {
    // Given pending contributions around an hourly Health snapshot.
    const first = await contribute();
    core.clock.advance(3_600_000);
    const snapshots = createPrismaHealthSnapshots(core.prisma);
    const base = await snapshots.baseAt(reader.fleetId, core.clock.now());
    const upTo = await contribute();

    // When they are marked read in one call.
    unwrap(await core.useCases.acknowledgeMeetingUpTo(reader, { meetingId, messageId: upTo }));
    const health = createPrismaHealthRecords(core.prisma);
    const records = await health.read(reader.fleetId, new Date(0));
    const acknowledged = await health.acknowledged(reader.fleetId, new Date(0));
    const replay = await snapshots.eventsAfter(reader.fleetId, { seq: base.seq });
    const { foldHealth } = await import('../src/domain/shared/health-fold.js');
    const folded = foldHealth(base, replay);
    const bootstrapped = await snapshots.baseAt(reader.fleetId, core.clock.now());

    // Then Health records and both snapshot paths see each read contribution as acknowledged, without clearing the added notice.
    expect(acknowledged).toHaveLength(2);
    expect(records.deliveries.filter((delivery) => [first, upTo].includes(delivery.messageId)).map((delivery) => delivery.steps.at(-1)?.state)).toEqual(['acknowledged', 'acknowledged']);
    expect(folded.acknowledged).toHaveLength(2);
    expect(folded.fold.deliveries.some((delivery) => [first, upTo].includes(delivery.messageId))).toBe(false);
    expect(bootstrapped.deliveries.some((delivery) => [first, upTo].includes(delivery.messageId))).toBe(false);
    expect(folded.fold.deliveries).toHaveLength(1);
  });

  it('uses indexed queries for contribution acknowledgement and its Health readers', async () => {
    // Given a retained contribution and SQL captured from the actual adapters.
    const upTo = await contribute();
    unwrap(await core.useCases.acknowledgeMeetingUpTo(reader, { meetingId, messageId: upTo }));
    const statements: { query: string; params: string }[] = [];
    const client = createPrismaClientTellingStatements(core.databaseUrl, (query, params) => { if (query.trimStart().startsWith('SELECT') || query.trimStart().startsWith('WITH')) statements.push({ query, params }); });
    try {
      // When the adapters acknowledge and read it.
      await client.$transaction(async (db) => {
        await createPrismaDeliveryRepository(db).acknowledgeMeetingContributionsUpTo({ fleetId: reader.fleetId, meetingId, shipId: reader.shipId, leaseId: reader.leaseId, upTo, eventId: ids('event') });
      });
      unwrap(await core.useCases.acknowledgeMeetingUpTo(reader, { meetingId, messageId: upTo }));
      await createPrismaHealthRecords(client).read(reader.fleetId, new Date(0));
      await createPrismaHealthRecords(client).acknowledged(reader.fleetId, new Date(0));
      await createPrismaHealthSnapshots(client).eventsAfter(reader.fleetId, { seq: 0 });
      await createPrismaHealthSnapshots(client).baseAt(reader.fleetId, core.clock.now());

      // Then no query scans the message, delivery or event history.
      expect(statements.length).toBeGreaterThan(0);
      for (const statement of statements) await assertIndexedPlan(core.prisma, statement);
    } finally { await client.$disconnect(); }
  });
});
