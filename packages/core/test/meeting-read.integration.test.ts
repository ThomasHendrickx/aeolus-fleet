/** #2038: durable mark-read, one transactional event, races, rollback, and Health replay. */
import { createIdGenerator, type MeetingId, type MessageId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaClient, createPrismaClientTellingStatements } from '../src/adapters/prisma/client.js';
import { createPrismaMeetingRepository } from '../src/adapters/prisma/meetings.js';
import { createPrismaExchangeRollups } from '../src/adapters/prisma/exchange-rollups.js';
import { createPrismaShipHistory } from '../src/adapters/prisma/history.js';
import { createPrismaHistoryPruner } from '../src/adapters/prisma/history-pruner.js';
import { readHarbourOf } from '../src/adapters/prisma/harbour.js';
import { createPrismaDeliveryRepository } from '../src/adapters/prisma/messaging.js';
import { createPrismaHealthRecords } from '../src/adapters/prisma/health.js';
import { createPrismaHealthSnapshots } from '../src/adapters/prisma/health-snapshots.js';
import { createPrismaUnitOfWork } from '../src/adapters/prisma/unit-of-work.js';
import { createAcknowledgeMeetingUpTo } from '../src/domain/messaging/acknowledge-meeting-up-to.js';
import { createReadMeeting } from '../src/domain/messaging/read-meeting.js';
import { createUseCases } from '../src/wiring.js';
import { newKey } from '../src/testing/keys.js';
import { unwrap } from '../src/testing/result.js';
import type { Crew, ShipCaller } from '../src/domain/shared/caller.js';
import { createInMemoryCore } from './support/in-memory.js';
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

  it('shows the acknowledgement time in the inbox after marking a contribution read', async () => {
    // Given an outstanding contribution and a later read time.
    const upTo = await contribute();
    core.clock.advance(1_000);

    // When the participant marks it read and lists the inbox.
    unwrap(await core.useCases.acknowledgeMeetingUpTo(reader, { meetingId, messageId: upTo }));
    const history = createPrismaShipHistory(core.prisma);
    const page = await history.inbox(reader.fleetId, { shipId: reader.shipId, filter: 'all', limit: 20 });
    const entry = page.items.find((item) => item.message.id === upTo);

    // Then the contribution has the read time and no reply.
    expect(entry).toMatchObject({ doneAt: core.clock.now(), repliedWith: null });
    if (entry === undefined) throw new Error('contribution missing from inbox');
    expect(await history.inboxMessage(reader.fleetId, { shipId: reader.shipId, deliveryId: entry.deliveryId })).toMatchObject({ doneAt: core.clock.now(), repliedWith: null });
  });

  it('shows the bulk acknowledgement in each contribution delivery history and Harbour activity', async () => {
    // Given an outstanding contribution.
    const upTo = await contribute();
    core.clock.advance(1_000);

    // When it is marked read.
    unwrap(await core.useCases.acknowledgeMeetingUpTo(reader, { meetingId, messageId: upTo }));
    const page = await createPrismaShipHistory(core.prisma).messageDeliveries(reader.fleetId, { messageId: upTo, limit: 20 });
    const harbour = await readHarbourOf(core.prisma, { fleetId: reader.fleetId, read: { shipIds: [reader.shipId], filter: {}, reach: { kind: 'every' } } });

    // Then every consumer reports the acknowledgement time rather than the send time.
    expect(page.items[0]?.steps[0]).toMatchObject({ type: 'DeliveryAcknowledged', occurredAt: core.clock.now() });
    expect(harbour.ships[0]?.ship.lastActivityAt).toEqual(core.clock.now());
  });

  it('retention keeps an unfolded bulk acknowledgement and its cutoff while another affected contribution survives', async () => {
    // Given two contributions, a snapshot before the mark, and one bulk read.
    const first = await contribute();
    const upTo = await contribute();
    const snapshots = createPrismaHealthSnapshots(core.prisma);
    const hour = core.clock.now();
    const fold = await snapshots.baseAt(reader.fleetId, hour);
    await snapshots.write(reader.fleetId, { hours: [{ hour, stuck: [], acknowledged: [] }], fold });
    core.clock.advance(1_000);
    unwrap(await core.useCases.acknowledgeMeetingUpTo(reader, { meetingId, messageId: upTo }));
    core.clock.advance(1_000);

    // When retention considers the affected messages.
    const candidates = await core.prisma.$transaction((db) => createPrismaHistoryPruner(db).candidates(reader.fleetId, { cutoff: core.clock.now(), after: null, limit: 20 }));

    // Then both wait for the bulk event to be folded; its cutoff also waits while an earlier affected delivery remains.
    expect(candidates.find((candidate) => candidate.id === first)?.hasUnfoldedEvent).toBe(true);
    expect(candidates.find((candidate) => candidate.id === upTo)).toMatchObject({ hasUnfoldedEvent: true, isNamedByReadDelivery: true });
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
        await createPrismaDeliveryRepository(db, createPrismaExchangeRollups(db)).acknowledgeMeetingContributionsUpTo({ fleetId: reader.fleetId, meetingId, shipId: reader.shipId, leaseId: reader.leaseId, upTo, eventId: ids('event') });
      });
      unwrap(await core.useCases.acknowledgeMeetingUpTo(reader, { meetingId, messageId: upTo }));
      await createPrismaHealthRecords(client).read(reader.fleetId, new Date(0));
      await createPrismaHealthRecords(client).acknowledged(reader.fleetId, new Date(0));
      await createPrismaHealthSnapshots(client).eventsAfter(reader.fleetId, { seq: 0 });
      await createPrismaHealthSnapshots(client).baseAt(reader.fleetId, core.clock.now());
      await createPrismaShipHistory(client).messageDeliveries(reader.fleetId, { messageId: upTo, limit: 20 });
      await readHarbourOf(client, { fleetId: reader.fleetId, read: { shipIds: [reader.shipId], filter: {}, reach: { kind: 'every' } } });
      await client.$transaction((db) => createPrismaHistoryPruner(db).candidates(reader.fleetId, { cutoff: core.clock.now(), after: null, limit: 20 }));

      // Then no query scans the message, delivery or event history.
      expect(statements.length).toBeGreaterThan(0);
      for (const statement of statements) await assertIndexedPlan(core.prisma, statement);
    } finally { await client.$disconnect(); }
  });
});


describe('meeting call details on Postgres (#2068)', () => {
  it('reads the first question without contributions, numbers later calls and counts closed calls', async () => {
    // Given a meeting that ends after three calls, without any calls yet.
    ({ meetingId } = unwrap(await core.useCases.openMeeting(chief, { ships: [{ shipId: reader.shipId }], endAfterCalls: 3, idempotencyKey: newKey(), model: MODEL })));
    expect(unwrap(await core.useCases.readMeeting(reader, { meetingId, limit: 1 }))).toMatchObject({ closedCalls: 0, call: null });
    const first = unwrap(await core.useCases.openCall(chief, { meetingId, question: 'First question?', model: MODEL, idempotencyKey: newKey() }));
    await contribute();

    // When the first call contribution is outside the contribution page.
    const read = unwrap(await core.useCases.readMeeting(reader, { meetingId, limit: 1 }));

    // Then the question and number are still available and no calls have closed.
    expect(read).toMatchObject({ closedCalls: 0, call: { callId: first.callId, question: 'First question?', number: 1 } });
    expect(read.contributions.items.map((item) => item.messageId)).not.toContain(first.callId);
    for (const by of [chief, reader]) unwrap(await core.useCases.sendMessage(by, { selector: { kind: 'meeting', meetingId }, callId: first.callId, payload: 'Ready', model: MODEL, idempotencyKey: newKey() }));
    const second = unwrap(await core.useCases.openCall(chief, { meetingId, question: 'Second question?', model: MODEL, idempotencyKey: newKey() }));
    expect(unwrap(await core.useCases.readMeeting(reader, { meetingId, limit: 1 }))).toMatchObject({ closedCalls: 1, endAfterCalls: 3, call: { callId: second.callId, question: 'Second question?', number: 2 } });
    expect(unwrap(await core.useCases.readMeeting(reader, { meetingId, callId: first.callId, limit: 1 }))).toMatchObject({ closedCalls: 1, call: { question: 'First question?', number: 1 } });
    for (const by of [chief, reader]) unwrap(await core.useCases.sendMessage(by, { selector: { kind: 'meeting', meetingId }, callId: second.callId, payload: 'Done', model: MODEL, idempotencyKey: newKey() }));
    expect(unwrap(await core.useCases.readMeeting(reader, { meetingId, limit: 1 }))).toMatchObject({ closedCalls: 2, call: { question: 'Second question?', number: 2 } });
  });
});


it('reads call counts through indexed meeting call ranges', async () => {
  // Given a call and a client that records the repository's actual SQL.
  const { callId } = unwrap(await core.useCases.openCall(chief, { meetingId, question: 'Indexed?', model: MODEL, idempotencyKey: newKey() }));
  const statements: { query: string; params: string }[] = [];
  const client = createPrismaClientTellingStatements(core.databaseUrl, (query, params) => { if (query.trimStart().startsWith('SELECT')) statements.push({ query, params }); });
  try {
    // When the repository reads the ordinal and closed count.
    const meetings = createPrismaMeetingRepository(client);
    expect(await meetings.callNumber(chief.fleetId, { meetingId, callId })).toBe(1);
    expect(await meetings.closedCallCount(chief.fleetId, meetingId)).toBe(0);
    // Then the queries use indexed ranges, without reading contributions.
    expect(statements).toHaveLength(2);
    for (const statement of statements) {
      const plan = await assertIndexedPlan(core.prisma, statement);
      expect(plan).toContain('Index');
      expect(plan).not.toContain('messages');
    }
    statements.length = 0;
    const read = createReadMeeting({ uow: createPrismaUnitOfWork(client), sealing: createInMemoryCore().sealing });
    expect(unwrap(await read(reader, { meetingId, limit: 1 }))).toMatchObject({ call: { question: 'Indexed?' } });
    for (const statement of statements) await assertIndexedPlan(core.prisma, statement);
  } finally { await client.$disconnect(); }
});
