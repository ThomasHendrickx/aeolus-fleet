import { createIdGenerator, type ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createPrismaFleetRepository } from '../src/adapters/prisma/registry.js';
import { createPrismaUnitOfWork, type PrismaTx } from '../src/adapters/prisma/unit-of-work.js';
import type { Crew, ShipCaller } from '../src/domain/shared/caller.js';
import { createPruneHistory } from '../src/domain/shared/prune-history.js';
import type { UnitOfWork } from '../src/domain/shared/unit-of-work.js';
import { newKey } from '../src/testing/keys.js';
import { unwrap } from '../src/testing/result.js';
import { operatorCaller, secretOf } from './support/core-fixtures.js';
import { withOperatorLogin } from './support/operator-login.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';

// Removing retired ships in the pruning pass on a real Postgres (decision
// 0070; the retired ships design, D2, D3, D5 and D9, scenarios 5 to 7, 11
// and 12): a ship retired before the cutoff becomes a remnant, one retired
// after it and every one in a fleet with no retention stays as it is, and a
// batch that fails or dies leaves the ship as it was.

const newId = createIdGenerator();
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const RETENTION_DAYS = 30;

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
