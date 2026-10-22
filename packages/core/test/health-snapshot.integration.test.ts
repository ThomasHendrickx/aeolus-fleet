import { createIdGenerator, idSchema, type DeliveryId, type MessageId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { sha256Hasher } from '../src/adapters/crypto/secrets.js';
import { createPrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetRepository } from '../src/adapters/prisma/registry.js';
import { createPrismaSnapshotUnitOfWork, type PrismaTx } from '../src/adapters/prisma/unit-of-work.js';
import { createSendMessage } from '../src/domain/messaging/send-message.js';
import type { Crew, ShipCaller } from '../src/domain/shared/caller.js';
import { createCloseHealthSnapshots } from '../src/domain/shared/close-health-snapshots.js';
import type { Health } from '../src/domain/shared/health.js';
import { ok } from '../src/domain/shared/result.js';
import type { Selector } from '../src/domain/shared/selector.js';
import type { UnitOfWork } from '../src/domain/shared/unit-of-work.js';
import { newKey } from '../src/testing/keys.js';
import { unwrap } from '../src/testing/result.js';
import { createUseCases } from '../src/wiring.js';
import { modelOf, operatorCaller, secretOf } from './support/core-fixtures.js';
import { withOperatorLogin } from './support/operator-login.js';
import { createPostgresCore, heldUnitOfWork, racingUnitOfWork, type PostgresCore } from './support/postgres-core.js';

// The stuck snapshot on a real Postgres (docs/design/performance/performance.md,
// sections 5 and 6): the 30 second pass closes each hour once, under the
// fleet's advisory lock, from the latest snapshot and the events after its
// seq; a restart, a second instance, a late commit and missed hours lose
// nothing and count nothing twice, and the health read from it counts as the
// replay of the fleet's events does.

const newId = createIdGenerator();
const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;

let core: PostgresCore;
let argo: ShipCaller;
let scout: Crew;
let planner: Crew;

async function crewed(ship: { name: string; type: string }): Promise<Crew> {
  const { shipId, secret } = unwrap(await core.useCases.commissionShip(argo, { ...ship, idempotencyKey: newKey() }));
  const { crewToken } = unwrap(await core.useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'DEVICE' }, harness: 'claude-code' }));
  return unwrap(await core.useCases.authenticate.byCrewToken(crewToken));
}

beforeEach(async () => {
  core = await createPostgresCore();
  argo = operatorCaller(unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'home fleet' }))));
  scout = await crewed({ name: 'scout', type: 'tester' });
  planner = await crewed({ name: 'planner', type: 'planner' });
});

afterEach(async () => {
  await core.close();
});

function closeWith(uow: UnitOfWork<PrismaTx>) {
  return createCloseHealthSnapshots({ fleets: createPrismaFleetRepository(core.prisma), uow, clock: core.clock });
}

async function sendTo(selector: Selector): Promise<MessageId> {
  core.clock.advance(SECOND_MS);
  return unwrap(
    await core.useCases.sendMessage(scout, { ...modelOf(scout), selector, payload: 'Review pr-1130', contentType: 'text/plain', idempotencyKey: `key-${newId('message')}` }),
  ).messageId;
}

async function deliveryOf(messageId: MessageId): Promise<DeliveryId> {
  const { id } = await core.prisma.delivery.findFirstOrThrow({ where: { messageId } });
  return idSchema('delivery').parse(id);
}

const hourRows = z.array(z.object({ hour: z.date(), seq: z.bigint(), stuck: z.array(z.object({ count: z.int() })) }));

async function rows() {
  return hourRows.parse(await core.prisma.$queryRaw`SELECT hour, seq, stuck FROM health_snapshots WHERE fleet_id = ${argo.fleetId} ORDER BY hour`);
}

/** How many deliveries the closed hour at `iso` counts stuck; none without a row. */
async function stuckAt(iso: string): Promise<number | undefined> {
  return (await rows()).find((row) => row.hour.toISOString() === iso)?.stuck.reduce((sum, counted) => sum + counted.count, 0);
}

/** The fleet as one founded before the stuck snapshot came: read by replaying its events. */
async function withoutSnapshot(): Promise<void> {
  await core.prisma.$executeRaw`DELETE FROM health_snapshot_deliveries WHERE fleet_id = ${argo.fleetId}`;
  await core.prisma.$executeRaw`DELETE FROM health_snapshots WHERE fleet_id = ${argo.fleetId}`;
}

/**
 * A fleet's 6 hours from 12:00, on the hour marks: a delivery to a type whose
 * last ship retired (stuck from 13:00 on), one handed on a plain lease whose
 * session went quiet (stalled 10 minutes on, until acknowledged at 16:20),
 * and one acknowledged within the hour. The pass runs at each `onHour`.
 */
async function sixHours(onHour: () => Promise<void>): Promise<void> {
  core.clock.set('2026-09-29T12:40:00.000Z');
  const quick = await sendTo({ kind: 'ship', shipId: planner.shipId });
  unwrap(await core.useCases.receiveDeliveries(planner, {}));
  core.clock.advance(5 * MINUTE_MS);
  unwrap(await core.useCases.acknowledgeDelivery(planner, { deliveryId: await deliveryOf(quick) }));
  core.clock.set('2026-09-29T13:00:30.000Z');
  await onHour();
  await sendTo({ kind: 'type', type: 'planner' });
  unwrap(await core.useCases.retireShip(argo, { shipId: planner.shipId }));
  core.clock.set('2026-09-29T14:00:30.000Z');
  await onHour();
  core.clock.set('2026-09-29T14:30:00.000Z');
  const quiet = await sendTo({ kind: 'ship', shipId: scout.shipId });
  unwrap(await core.useCases.receiveDeliveries(scout, {}));
  core.clock.set('2026-09-29T15:00:30.000Z');
  await onHour();
  core.clock.set('2026-09-29T16:00:30.000Z');
  await onHour();
  core.clock.set('2026-09-29T16:20:00.000Z');
  unwrap(await core.useCases.acknowledgeDelivery(scout, { deliveryId: await deliveryOf(quiet) }));
  core.clock.set('2026-09-29T17:00:30.000Z');
  await onHour();
  core.clock.set('2026-09-29T18:00:00.000Z');
}

/** The health as the replay of the fleet's events reads it, with no snapshot. */
async function replayed(): Promise<Health> {
  await withoutSnapshot();
  return core.useCases.readHealth(argo);
}

function expectSameCounts(fromSnapshot: Health, replay: Health): void {
  expect(fromSnapshot.stuck).toEqual(replay.stuck);
  // The replay's hours end at now; the snapshot's at each hour mark, then now: at 18:00 the same marks.
  expect(fromSnapshot.stuckPerHour.slice(0, -1)).toEqual(replay.stuckPerHour.slice(1));
  expect(fromSnapshot.stuckPerHour.at(-1)).toEqual(replay.stuckPerHour.at(-1));
  expect(fromSnapshot.acknowledged.count).toBe(replay.acknowledged.count);
  expect(fromSnapshot.acknowledged.perHour.slice(0, -1)).toEqual(replay.acknowledged.perHour.slice(1));
}

describe('the health read from the stuck snapshot', () => {
  it('counts as the replay of the fleet events does, closed hour by hour in the pass', async () => {
    await sixHours(() => core.useCases.closeHealthSnapshots());
    await core.useCases.closeHealthSnapshots();
    const fromSnapshot = await core.useCases.readHealth(argo);

    expectSameCounts(fromSnapshot, await replayed());
    // 13:00 to 18:00, then now: the type's delivery from 13:00:31, the quiet one stalled from 14:40 until 16:20.
    expect(fromSnapshot.stuckPerHour.slice(-7).map((hour) => hour.count)).toEqual([0, 1, 2, 2, 1, 1, 1]);
  });

  it("counts as the replay does from a fleet's first snapshot, replayed once from its events", async () => {
    await sixHours(() => Promise.resolve());
    await withoutSnapshot();
    const replay = await core.useCases.readHealth(argo);

    await core.useCases.closeHealthSnapshots();
    const fromSnapshot = await core.useCases.readHealth(argo);

    expect(await rows()).toHaveLength(168);
    expectSameCounts(fromSnapshot, replay);
  });

  it('folds the events of the open hour for what is stuck now', async () => {
    core.clock.set('2026-09-29T13:00:30.000Z');
    await core.useCases.closeHealthSnapshots();
    await sendTo({ kind: 'type', type: 'planner' });
    unwrap(await core.useCases.retireShip(argo, { shipId: planner.shipId }));

    const health = await core.useCases.readHealth(argo);

    expect(health.stuck).toMatchObject([{ cause: 'noShipCanTake', place: { kind: 'type', type: 'planner' }, count: 1 }]);
    expect(health.stuckPerHour.at(-2)).toEqual({ at: new Date('2026-09-29T13:00:00.000Z'), count: 0 });
  });

  it('keeps the open deliveries as of the latest hour, each at its latest step', async () => {
    core.clock.set('2026-09-29T12:30:00.000Z');
    const handed = await sendTo({ kind: 'ship', shipId: scout.shipId });
    unwrap(await core.useCases.receiveDeliveries(scout, {}));
    core.clock.set('2026-09-29T13:00:30.000Z');

    await core.useCases.closeHealthSnapshots();

    await expect(core.prisma.healthSnapshotDelivery.findMany({ where: { fleetId: argo.fleetId } })).resolves.toEqual([
      expect.objectContaining({ deliveryId: await deliveryOf(handed), state: 'handed', stepShipId: scout.shipId, leaseId: scout.leaseId }),
    ]);
  });
});

describe('a restart mid-hour', () => {
  it('loses nothing: the next instance closes the hour from the events written before it', async () => {
    core.clock.set('2026-09-29T12:20:00.000Z');
    await sendTo({ kind: 'type', type: 'planner' });
    unwrap(await core.useCases.retireShip(argo, { shipId: planner.shipId }));

    const restarted = createPrismaClient(core.databaseUrl);
    try {
      core.clock.set('2026-09-29T13:00:30.000Z');
      await createUseCases({ prisma: restarted, clock: core.clock }).closeHealthSnapshots();
    } finally {
      await restarted.$disconnect();
    }

    await expect(stuckAt('2026-09-29T13:00:00.000Z')).resolves.toBe(1);
  });

  it('rolls a close cut off midway back whole, and the next pass closes the hour', async () => {
    core.clock.set('2026-09-29T12:20:00.000Z');
    await sendTo({ kind: 'type', type: 'planner' });
    unwrap(await core.useCases.retireShip(argo, { shipId: planner.shipId }));
    core.clock.set('2026-09-29T13:00:30.000Z');
    const snapshotUow = createPrismaSnapshotUnitOfWork(core.prisma);
    const cutOff = closeWith({
      run: (work) =>
        snapshotUow.run((tx) =>
          work({
            ...tx,
            healthSnapshots: {
              ...tx.healthSnapshots,
              write: async (fleetId, snapshot) => {
                await tx.healthSnapshots.write(fleetId, snapshot);
                throw new Error('core stopped');
              },
            },
          }),
        ),
    });

    await expect(cutOff()).rejects.toThrow('core stopped');
    await expect(rows()).resolves.toHaveLength(1);
    await expect(core.prisma.healthSnapshotDelivery.count()).resolves.toBe(0);

    await core.useCases.closeHealthSnapshots();
    await expect(stuckAt('2026-09-29T13:00:00.000Z')).resolves.toBe(1);
  });
});

describe('two instances closing the same hour', () => {
  it('write it once: the second finds the snapshot lock held and skips the fleet', async () => {
    core.clock.set('2026-09-29T12:20:00.000Z');
    await sendTo({ kind: 'type', type: 'planner' });
    unwrap(await core.useCases.retireShip(argo, { shipId: planner.shipId }));
    core.clock.set('2026-09-29T13:00:30.000Z');
    const racing = closeWith(
      racingUnitOfWork({ prisma: core.prisma, transactions: 2 }, (tx, allArrived): PrismaTx => ({
        ...tx,
        healthSnapshots: {
          ...tx.healthSnapshots,
          latest: async (fleetId) => {
            await allArrived();
            return tx.healthSnapshots.latest(fleetId);
          },
        },
      })),
    );

    await Promise.all([racing(), racing()]);

    await expect(rows()).resolves.toMatchObject([{ hour: new Date('2026-09-29T12:00:00.000Z') }, { hour: new Date('2026-09-29T13:00:00.000Z') }]);
    await expect(stuckAt('2026-09-29T13:00:00.000Z')).resolves.toBe(1);
  });

  it('closes nothing again for the one that takes the lock after the first committed', async () => {
    core.clock.set('2026-09-29T13:00:30.000Z');
    await core.useCases.closeHealthSnapshots();
    const closed = await rows();

    const second = createPrismaClient(core.databaseUrl);
    try {
      await createUseCases({ prisma: second, clock: core.clock }).closeHealthSnapshots();
    } finally {
      await second.$disconnect();
    }

    await expect(rows()).resolves.toEqual(closed);
  });

  it('keeps the first row of an hour written twice: ON CONFLICT DO NOTHING', async () => {
    core.clock.set('2026-09-29T13:00:30.000Z');
    await core.useCases.closeHealthSnapshots();
    const closed = await rows();
    const { hour } = closed.at(-1) ?? { hour: new Date(0) };

    await createPrismaSnapshotUnitOfWork(core.prisma).run(async (tx) => {
      await tx.healthSnapshots.write(argo.fleetId, { hours: [{ hour, stuck: [], acknowledged: [] }], fold: { seq: 999, deliveries: [], turns: [] } });
      return ok(undefined);
    });

    await expect(rows()).resolves.toEqual(closed);
  });
});

describe('a late commit', () => {
  it('is folded into the next hour: an event written before the mark that commits after the close', async () => {
    core.clock.set('2026-09-29T13:59:59.000Z');
    const released = Promise.withResolvers<undefined>();
    const { uow, reached } = heldUnitOfWork(core.prisma, (tx, hold) => ({
      ...tx,
      events: {
        ...tx.events,
        append: async (event) => {
          await tx.events.append(event);
          await hold(released.promise);
        },
      },
    }));
    const send = createSendMessage({ uow, clock: core.clock, ids: newId, hasher: sha256Hasher });
    // To a ship awaiting crew: stuck from its send, waiting for crew.
    const { shipId: writer } = unwrap(await core.useCases.commissionShip(argo, { name: 'docs-writer', type: 'writer', idempotencyKey: newKey() }));
    const sending = send(scout, { ...modelOf(scout), selector: { kind: 'ship', shipId: writer }, payload: 'Docs for pr-1130', contentType: 'text/plain', idempotencyKey: newKey() });
    await reached;

    core.clock.set('2026-09-29T14:00:30.000Z');
    await core.useCases.closeHealthSnapshots();
    released.resolve(undefined);
    unwrap(await sending);
    core.clock.set('2026-09-29T15:00:30.000Z');
    await core.useCases.closeHealthSnapshots();

    await expect(stuckAt('2026-09-29T14:00:00.000Z')).resolves.toBe(0);
    await expect(stuckAt('2026-09-29T15:00:00.000Z')).resolves.toBe(1);
    await expect(core.useCases.readHealth(argo)).resolves.toMatchObject({ stuck: [{ cause: 'waitingForCrew', count: 1, oldestSince: new Date('2026-09-29T13:59:59.000Z') }] });
  });
});

describe('missed hours', () => {
  it('are closed one at a time, oldest first, by the first pass after core was down', async () => {
    core.clock.set('2026-09-29T12:20:00.000Z');
    await sendTo({ kind: 'type', type: 'planner' });
    unwrap(await core.useCases.retireShip(argo, { shipId: planner.shipId }));
    core.clock.set('2026-09-29T17:10:00.000Z');

    await core.useCases.closeHealthSnapshots();

    const closed = await rows();
    expect(closed.map((row) => row.hour.toISOString())).toEqual([
      '2026-09-29T12:00:00.000Z',
      '2026-09-29T13:00:00.000Z',
      '2026-09-29T14:00:00.000Z',
      '2026-09-29T15:00:00.000Z',
      '2026-09-29T16:00:00.000Z',
      '2026-09-29T17:00:00.000Z',
    ]);
    expect(closed.map((row) => row.stuck.reduce((sum, counted) => sum + counted.count, 0))).toEqual([0, 1, 1, 1, 1, 1]);
    expect(new Set(closed.slice(1).map((row) => row.seq)).size).toBe(1);
  });

  it('are read right while the pass has not closed them, folding every event after the latest', async () => {
    core.clock.set('2026-09-29T12:20:00.000Z');
    await sendTo({ kind: 'type', type: 'planner' });
    unwrap(await core.useCases.retireShip(argo, { shipId: planner.shipId }));
    core.clock.set('2026-09-29T15:10:00.000Z');

    const health = await core.useCases.readHealth(argo);

    expect(health.stuckPerHour.slice(-5).map((hour) => hour.count)).toEqual([0, 1, 1, 1, 1]);
    await expect(rows()).resolves.toHaveLength(1);
  });

  it('give a fleet whose latest hour is over 168 hours old its first snapshot again', async () => {
    core.clock.set('2026-09-29T12:20:00.000Z');
    await sendTo({ kind: 'type', type: 'planner' });
    unwrap(await core.useCases.retireShip(argo, { shipId: planner.shipId }));
    core.clock.advance(170 * HOUR_MS);

    await core.useCases.closeHealthSnapshots();

    const closed = await rows();
    expect(closed).toHaveLength(168);
    expect(closed.at(-1)?.hour).toEqual(new Date('2026-10-06T14:00:00.000Z'));
    await expect(stuckAt('2026-10-06T14:00:00.000Z')).resolves.toBe(1);
  });
});
