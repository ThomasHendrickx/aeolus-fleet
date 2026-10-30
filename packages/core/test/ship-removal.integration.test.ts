import { createIdGenerator, idSchema, QUESTION_CONTENT_TYPE, type ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createPrismaFleetRepository } from '../src/adapters/prisma/registry.js';
import { createPrismaUnitOfWork, type PrismaTx } from '../src/adapters/prisma/unit-of-work.js';
import type { Crew, ShipCaller } from '../src/domain/shared/caller.js';
import { UNDELIVERABLE_AT_ATTEMPT } from '../src/domain/messaging/delivery.js';
import { createPruneHistory } from '../src/domain/shared/prune-history.js';
import type { UnitOfWork } from '../src/domain/shared/unit-of-work.js';
import { newKey } from '../src/testing/keys.js';
import { unwrap } from '../src/testing/result.js';
import { operatorCaller, secretOf } from './support/core-fixtures.js';
import { withOperatorLogin } from './support/operator-login.js';
import { createPostgresCore, heldUnitOfWork, type PostgresCore } from './support/postgres-core.js';

// Removing retired ships in the pruning pass on a real Postgres (decision
// 0070; the retired ships design, D2, D3, D5 and D9, scenarios 5 to 7, 11
// and 12): a ship retired before the cutoff becomes a remnant, one retired
// after it and every one in a fleet with no retention stays as it is, and a
// batch that fails or dies leaves the ship as it was.

const newId = createIdGenerator();
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const RETENTION_DAYS = 30;
const MODEL = 'claude-opus-5-5';
/** Longer than a commission takes, shorter than a unit of work's timeout. */
const RACE_WAIT_MS = 2_000;

let core: PostgresCore;
let argo: ShipCaller;

beforeEach(async () => {
  core = await createPostgresCore();
  argo = operatorCaller(unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'home fleet' }))));
  await retainFor(RETENTION_DAYS);
});

afterEach(async () => {
  await core.close();
});

async function retainFor(days: number | null): Promise<void> {
  await core.prisma.$executeRaw`UPDATE fleets SET retention_set = true, retention_days = ${days} WHERE id = ${argo.fleetId}`;
}

/** A ship argo commissions with a note and a key, then retires. */
async function aRetiredShip(name: string, idempotencyKey = newKey()): Promise<ShipId> {
  const { shipId } = unwrap(await core.useCases.commissionShip(argo, { name, type: 'planner', note: 'Plans the retention slice', idempotencyKey }));
  core.clock.advance(1_000);
  unwrap(await core.useCases.retireShip(argo, { shipId }));
  return shipId;
}

async function crewed(ship: { name: string; type: string }): Promise<Crew> {
  const { shipId, secret } = unwrap(await core.useCases.commissionShip(argo, { ...ship, idempotencyKey: newKey() }));
  const { crewToken } = unwrap(await core.useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'DEVICE' }, harness: 'claude-code' }));
  return unwrap(await core.useCases.authenticate.byCrewToken(crewToken));
}

/** A ship retired, then removed by the pass past the retention. */
async function aRemovedShip(name: string, idempotencyKey = newKey()): Promise<ShipId> {
  const shipId = await aRetiredShip(name, idempotencyKey);
  await passAfter((RETENTION_DAYS + 1) * DAY_MS);
  return shipId;
}

/** The 30 second pass: the snapshot close, then the pruning pass. */
async function passAfter(ms: number): Promise<void> {
  core.clock.advance(ms);
  await core.useCases.closeHealthSnapshots();
  await core.useCases.pruneHistory();
}

function passWith(uow: UnitOfWork<PrismaTx>, options: { batch?: number; budgetMs?: number } = {}) {
  return createPruneHistory({ fleets: createPrismaFleetRepository(core.prisma), uow, clock: core.clock, ids: newId, ...options });
}

/** A unit of work whose batches fail once they made their set go. */
function failingAfterGo(go: (tx: PrismaTx, ...args: Parameters<PrismaTx['historyPruner']['go']>) => ReturnType<PrismaTx['historyPruner']['go']>): UnitOfWork<PrismaTx> {
  const failing = createPrismaUnitOfWork(core.prisma);
  return {
    run: (work) => failing.run((tx) => work({ ...tx, historyPruner: { ...tx.historyPruner, go: (...args) => go(tx, ...args) } })),
  };
}

async function shipRow(shipId: ShipId) {
  return core.prisma.ship.findUniqueOrThrow({ where: { id: shipId } });
}

async function shipsPruned(): Promise<(number | undefined)[]> {
  const events = await core.prisma.event.findMany({ where: { fleetId: argo.fleetId, type: 'HistoryPruned' }, orderBy: { seq: 'asc' } });
  return events.map((event) => z.object({ ships: z.int().optional() }).parse(event.details).ships);
}

describe('removing retired ships in the pruning pass on Postgres', () => {
  it('scenario 5: a ship retired 31 days ago in a fleet with a 30 day retention is removed: a remnant row, counted in HistoryPruned', async () => {
    // Given
    const shipId = await aRetiredShip('planner');
    const retired = await shipRow(shipId);

    // When
    await passAfter((RETENTION_DAYS + 1) * DAY_MS);

    // Then
    const remnant = await shipRow(shipId);
    expect(remnant).toMatchObject({
      id: shipId,
      name: 'planner',
      type: 'planner',
      kind: 'agent',
      createdAt: retired.createdAt,
      retiredAt: retired.retiredAt,
      removedAt: core.clock.now(),
      scopes: [],
      note: null,
      ownerShipId: null,
      commissionedByKind: null,
      commissionedBy: null,
      commissionKey: null,
      commissionRequestHash: null,
    });
    expect(await shipsPruned()).toEqual([1]);
  });

  it('scenario 6: a ship retired 29 days ago in that fleet is not removed', async () => {
    // Given
    const shipId = await aRetiredShip('planner');

    // When
    await passAfter((RETENTION_DAYS - 1) * DAY_MS);

    // Then
    expect(await shipRow(shipId)).toMatchObject({ removedAt: null, note: 'Plans the retention slice' });
  });

  it('scenario 7: a ship retired a year ago in a fleet with no retention is not removed', async () => {
    // Given
    await retainFor(null);
    const shipId = await aRetiredShip('planner');

    // When
    await passAfter(365 * DAY_MS);

    // Then
    expect(await shipRow(shipId)).toMatchObject({ removedAt: null, note: 'Plans the retention slice' });
  });

  it('scenario 11: a batch that fails after clearing a ship row leaves the ship as it was, and writes no HistoryPruned', async () => {
    // Given
    const shipId = await aRetiredShip('planner');
    const retired = await shipRow(shipId);
    core.clock.advance((RETENTION_DAYS + 1) * DAY_MS);
    await core.useCases.closeHealthSnapshots();
    const uow = failingAfterGo(async (tx, ...args) => {
      await tx.historyPruner.go(...args);
      throw new Error('disk full');
    });

    // When
    await passWith(uow)(() => undefined);

    // Then
    expect(await shipRow(shipId)).toEqual(retired);
    expect(await shipsPruned()).toEqual([]);
  });

  it('scenario 12: more retired ships than a batch takes are removed oldest retire first, the rest the next hour once the budget is spent', async () => {
    // Given
    const oldest = await aRetiredShip('scout');
    const older = await aRetiredShip('lookout');
    const newest = await aRetiredShip('planner');
    core.clock.advance((RETENTION_DAYS + 1) * DAY_MS);
    await core.useCases.closeHealthSnapshots();

    // When
    await passWith(createPrismaUnitOfWork(core.prisma), { batch: 2, budgetMs: 0 })();
    const leftAfterTheFirstBatch = (await shipRow(newest)).removedAt;
    await passAfter(HOUR_MS);

    // Then
    expect((await shipRow(oldest)).removedAt).not.toBeNull();
    expect((await shipRow(older)).removedAt).not.toBeNull();
    expect(leftAfterTheFirstBatch).toBeNull();
    expect((await shipRow(newest)).removedAt).not.toBeNull();
    expect(await shipsPruned()).toEqual([2, 1]);
  });

  it('goes on the next hour after a pass that died mid-way: the ship is removed then', async () => {
    // Given
    const shipId = await aRetiredShip('planner');
    core.clock.advance((RETENTION_DAYS + 1) * DAY_MS);
    await core.useCases.closeHealthSnapshots();
    await passWith(failingAfterGo(() => Promise.reject(new Error('server stopped'))))();

    // When
    await core.useCases.pruneHistory();
    const removedWithinTheHour = (await shipRow(shipId)).removedAt;
    await passAfter(HOUR_MS);

    // Then
    expect(removedWithinTheHour).toBeNull();
    expect((await shipRow(shipId)).removedAt).not.toBeNull();
  });
});

describe('a removed ship in the reads (D4)', () => {
  it('scenario 3: with Show retired on, a removed ship is not in the list, and fleet.list with the retired status does not answer it', async () => {
    // Given
    const removed = await aRemovedShip('planner');
    const retired = await aRetiredShip('lookout');

    // When
    const withRetired = await core.useCases.listFleet(argo, { status: ['awaitingCrew', 'crewed', 'retired'] });
    const retiredOnly = await core.useCases.listFleet(argo, { status: ['retired'] });

    // Then
    expect(withRetired.ships.map((ship) => ship.id)).not.toContain(removed);
    expect(retiredOnly.ships.map((ship) => ship.id)).toEqual([retired]);
  });

  it('scenario 4: a removed ship is not in discovery, the send and owner pickers, the ship types or the counts', async () => {
    // Given
    const removed = await aRemovedShip('planner');
    const scout = await crewed({ name: 'scout', type: 'reviewer' });

    // When
    const discovered = unwrap(await core.useCases.discover(scout));
    const picked = await core.useCases.listFleet(argo, {});
    const owners = await core.useCases.listFleet(argo, { shipKind: ['operator', 'person'] });
    const types = await core.useCases.listShipTypes(argo, { status: ['awaitingCrew', 'crewed', 'retired'] });
    const counts = await core.useCases.countShips(argo);

    // Then
    expect(discovered.ships.map((ship) => ship.id)).not.toContain(removed);
    expect(picked.ships.map((ship) => ship.id)).not.toContain(removed);
    expect(owners.ships.map((ship) => ship.id)).not.toContain(removed);
    expect(types).not.toContain('planner');
    expect(counts.find((count) => count.kind === 'agent')?.retired ?? 0).toBe(0);
  });
});

describe('a removed ship stays retired (D6)', () => {
  /** What a register with its secret, a send to it and a schedule to it answer, by refusal kind, and whether any of them stored a row. */
  async function addressed(shipId: ShipId, secret: string | null, sender: Crew) {
    const before = { messages: await core.prisma.message.count(), schedules: await core.prisma.schedule.count() };
    const claim = await core.useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'DEVICE' }, harness: 'claude-code' });
    const send = await core.useCases.sendMessage(sender, { model: MODEL, selector: { kind: 'ship', shipId }, payload: 'Hi', idempotencyKey: newKey() });
    const schedule = await core.useCases.scheduleMessage(sender, {
      selector: { kind: 'ship', shipId },
      payload: 'Check in',
      model: MODEL,
      idempotencyKey: newKey(),
      timing: { kind: 'once', at: new Date(core.clock.now().getTime() + HOUR_MS) },
    });
    const isStored = (await core.prisma.message.count()) !== before.messages || (await core.prisma.schedule.count()) !== before.schedules;
    return { refusals: [claim, send, schedule].map((result) => (result.isOk ? 'ok' : result.error.kind)), isStored };
  }

  async function commissionedAndRetired(name: string): Promise<{ shipId: ShipId; secret: string | null }> {
    const { shipId, secret } = unwrap(await core.useCases.commissionShip(argo, { name, type: 'planner', idempotencyKey: newKey() }));
    unwrap(await core.useCases.retireShip(argo, { shipId }));
    return { shipId, secret };
  }

  it('scenario 13: a register with its id, a send to it and a schedule naming it are refused as for a retired ship, storing nothing', async () => {
    // Given
    const sender = await crewed({ name: 'scout', type: 'reviewer' });
    const removed = await commissionedAndRetired('planner');
    await passAfter((RETENTION_DAYS + 1) * DAY_MS);
    const retired = await commissionedAndRetired('lookout');

    // When
    const toRemoved = await addressed(removed.shipId, removed.secret, sender);
    const toRetired = await addressed(retired.shipId, retired.secret, sender);

    // Then
    expect((await shipRow(removed.shipId)).removedAt).not.toBeNull();
    expect(toRemoved.refusals).not.toContain('ok');
    expect(toRemoved).toEqual(toRetired);
    expect(toRemoved.isStored).toBe(false);
  });

  it('scenario 14: a ship commissioned with the name of a removed ship is commissioned with a new id', async () => {
    // Given
    const removed = await aRemovedShip('planner');

    // When
    const commissioned = await core.useCases.commissionShip(argo, { name: 'planner', type: 'planner', idempotencyKey: newKey() });

    // Then
    expect(commissioned).toMatchObject({ isOk: true });
    expect(unwrap(commissioned).shipId).not.toBe(removed);
  });
});

describe('a commission repeated with the key of a retired ship (D7)', () => {
  const planner = { name: 'planner', type: 'planner', note: 'Plans the retention slice' };

  it('scenario 15: before removal, the same commission repeated with its key answers the retired ship', async () => {
    // Given
    const retired = await aRetiredShip('planner', 'k');

    // When
    const repeated = await core.useCases.commissionShip(argo, { ...planner, idempotencyKey: 'k' });

    // Then
    expect(unwrap(repeated).shipId).toBe(retired);
  });

  it('scenario 16: after removal, the same commission repeated with its key commissions a new ship with a new id', async () => {
    // Given
    const removed = await aRemovedShip('planner', 'k');

    // When
    const repeated = await core.useCases.commissionShip(argo, { ...planner, idempotencyKey: 'k' });

    // Then
    const { shipId } = unwrap(repeated);
    expect(shipId).not.toBe(removed);
    expect(await shipRow(shipId)).toMatchObject({ name: 'planner', retiredAt: null, commissionKey: 'k' });
  });

  it('scenario 17: a commission repeated with its key while the pass removes its ship answers the retired ship or a new one, and no two ships hold the key', async () => {
    // Given
    const retired = await aRetiredShip('planner', 'k');
    core.clock.advance((RETENTION_DAYS + 1) * DAY_MS);
    await core.useCases.closeHealthSnapshots();
    const commission = Promise.withResolvers<void>();
    const { uow, reached } = heldUnitOfWork(core.prisma, (tx, hold) => ({
      ...tx,
      historyPruner: {
        ...tx.historyPruner,
        go: async (...args) => {
          const counts = await tx.historyPruner.go(...args);
          await hold(commission.promise);
          return counts;
        },
      },
    }));
    const pass = passWith(uow)();
    await reached;

    // When
    const repeated = core.useCases.commissionShip(argo, { ...planner, idempotencyKey: 'k' });
    await Promise.race([repeated.then(() => undefined), new Promise((resolve) => setTimeout(resolve, RACE_WAIT_MS))]);
    commission.resolve();
    await pass;
    const answered = unwrap(await repeated).shipId;

    // Then
    expect((await shipRow(retired)).removedAt).not.toBeNull();
    expect(answered === retired || (await shipRow(answered)).retiredAt === null).toBe(true);
    expect(await core.prisma.ship.count({ where: { fleetId: argo.fleetId, commissionKey: 'k' } })).toBeLessThanOrEqual(1);
  });
});

describe('the history that names a removed ship (D3)', () => {
  it('scenario 9: a kept message, its delivery, the kept events and an ended meeting naming a removed ship stay, and show it by name and type as retired', async () => {
    // Given
    const { shipId, secret } = unwrap(await core.useCases.commissionShip(argo, { name: 'planner', type: 'planner', scopes: ['meetings:open'], idempotencyKey: newKey() }));
    const { crewToken } = unwrap(await core.useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'DEVICE' }, harness: 'claude-code' }));
    const planner = unwrap(await core.useCases.authenticate.byCrewToken(crewToken));
    const { messageId: question } = unwrap(
      await core.useCases.sendMessage(planner, {
        model: MODEL,
        selector: { kind: 'ship', shipId: argo.shipId },
        contentType: QUESTION_CONTENT_TYPE,
        payload: '{"id":"q-1","title":"Ship it?"}',
        idempotencyKey: newKey(),
      }),
    );
    const { meetingId } = unwrap(await core.useCases.openMeeting(planner, { ships: [{ shipId: argo.shipId }], idempotencyKey: newKey(), model: MODEL }));
    core.clock.advance(1_000);
    unwrap(await core.useCases.retireShip(argo, { shipId }));
    await passAfter((RETENTION_DAYS + 1) * DAY_MS);

    // When
    const message = unwrap(await core.useCases.readMessage(argo, { messageId: question }));
    const timeline = unwrap(await core.useCases.readShipTimeline(argo, { shipId }));
    const listed = unwrap(await core.useCases.readListedShip(argo, { shipId }));
    const meeting = unwrap(await core.useCases.readMeeting(argo, { meetingId, limit: 20 }));

    // Then
    expect((await shipRow(shipId)).removedAt).not.toBeNull();
    expect(message.sender).toEqual({ id: shipId, name: 'planner' });
    expect(await core.prisma.delivery.count({ where: { messageId: question } })).toBe(1);
    expect(timeline.items.map((entry) => entry.type)).toEqual(expect.arrayContaining(['ShipCommissioned', 'ShipRetired']));
    expect(timeline.items.filter((entry) => entry.ship?.id === shipId).every((entry) => entry.ship?.name === 'planner')).toBe(true);
    expect(listed).toMatchObject({ id: shipId, name: 'planner', type: 'planner', status: 'retired' });
    expect(meeting).toMatchObject({ owner: { id: shipId, name: 'planner' }, endedAt: expect.any(Date) });
  });

  it('scenario 10: an undeliverable delivery to a removed ship stays on Health naming it; a resend is refused and a dismiss works', async () => {
    // Given
    const planner = await crewed({ name: 'planner', type: 'planner' });
    const { shipId } = planner;
    const { messageId } = unwrap(await core.useCases.sendMessage(argo, { selector: { kind: 'ship', shipId }, payload: 'Plan it', idempotencyKey: newKey() }));
    const { messageId: next } = unwrap(await core.useCases.sendMessage(argo, { selector: { kind: 'ship', shipId }, payload: 'Then this', idempotencyKey: newKey() }));
    // Received without an acknowledgement until undeliverable; the next message waits behind it, so the last receive hands that one out.
    for (let claim = 1; claim <= UNDELIVERABLE_AT_ATTEMPT; claim += 1) {
      core.clock.advance(1_000);
      unwrap(await core.useCases.receiveDeliveries(planner, {}));
    }
    const deliveryOf = async (of: typeof messageId) => idSchema('delivery').parse((await core.prisma.delivery.findFirstOrThrow({ where: { messageId: of } })).id);
    unwrap(await core.useCases.acknowledgeDelivery(planner, { deliveryId: await deliveryOf(next) }));
    const deliveryId = await deliveryOf(messageId);
    core.clock.advance(1_000);
    unwrap(await core.useCases.retireShip(argo, { shipId }));
    await passAfter((RETENTION_DAYS + 1) * DAY_MS);

    // When
    const onHealth = unwrap(await core.useCases.readNeedsAttention(argo, {})).items;
    const resent = await core.useCases.resendDelivery(argo, { deliveryId });
    const dismissed = await core.useCases.dismissDelivery(argo, { deliveryId });

    // Then
    expect((await shipRow(shipId)).removedAt).not.toBeNull();
    expect(onHealth).toEqual([expect.objectContaining({ deliveryId, ship: { id: shipId, name: 'planner' } })]);
    expect(resent).toMatchObject({ isOk: false });
    expect(dismissed).toMatchObject({ isOk: true });
  });
});
