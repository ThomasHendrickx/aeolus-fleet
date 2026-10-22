import { beforeEach, describe, expect, it } from 'vitest';

import { crewAboard, deliveryIdOf } from '../../../test/support/core-fixtures.js';
import { historyScenario, type HistoryScenario } from '../../../test/support/history-scenario.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';
import { readReachScenario, type ReadReachScenario } from '../../../test/support/read-reach-scenario.js';
import type { InMemoryCore } from '../../../test/support/in-memory.js';
import { createCloseHealthSnapshots } from './close-health-snapshots.js';

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;

let scene: HistoryScenario;

beforeEach(async () => {
  scene = await historyScenario();
});

async function commission(name: string, type: string) {
  return unwrap(await scene.registry.commissionShip(scene.argo, { idempotencyKey: newKey(), name, type })).shipId;
}

/** The planner, the last ship of its type, retires. */
async function lastPlannerRetires(): Promise<void> {
  unwrap(await scene.registry.retireShip(scene.argo, { shipId: scene.planner.shipId }));
}

async function readHealth() {
  return scene.history.readHealth(scene.argo);
}

/** One pass of the stuck snapshot's close. */
async function closeSnapshot(core: InMemoryCore): Promise<void> {
  await createCloseHealthSnapshots({ fleets: core.fleets, uow: core.uow, clock: core.clock })();
}

describe('reading the fleet health', () => {
  it('answers nothing stuck and every hour of the last 7 days at none while deliveries move', async () => {
    const messageId = await scene.send(scene.scout, { to: { kind: 'type', type: 'planner' } });
    await scene.receive(scene.planner);
    await scene.ack(scene.planner, messageId);

    const health = await readHealth();

    expect(health.stuck).toEqual([]);
    expect(health.stuckPerHour).toHaveLength(168);
    expect(health.stuckPerHour.every((hour) => hour.count === 0)).toBe(true);
    expect(health.stuckPerHour.at(-1)?.at).toEqual(scene.core.clock.now());
  });

  it('places a delivery to a type whose last ship retired at the type, waiting since it was sent', async () => {
    await scene.send(scene.scout, { to: { kind: 'type', type: 'planner' } });
    const sentAt = scene.core.clock.now();
    await lastPlannerRetires();

    await expect(readHealth()).resolves.toMatchObject({
      stuck: [{ cause: 'noShipCanTake', place: { kind: 'type', type: 'planner' }, count: 1, oldestSince: sentAt }],
    });
  });

  it('places deliveries to a ship awaiting crew at that ship, with its name and no machine', async () => {
    const docsWriter = await commission('docs-writer', 'writer');
    await scene.send(scene.scout, { to: { kind: 'ship', shipId: docsWriter } });
    const sentAt = scene.core.clock.now();
    await scene.send(scene.lookout, { to: { kind: 'ship', shipId: docsWriter } });

    await expect(readHealth()).resolves.toMatchObject({
      stuck: [{ cause: 'waitingForCrew', place: { kind: 'ship', ship: { id: docsWriter, name: 'docs-writer' }, machine: null }, count: 2, oldestSince: sentAt }],
    });
  });

  it('names the machine whose trierarch its crew request is assigned to, last seen when its crew started', async () => {
    const docsWriter = await commission('docs-writer', 'writer');
    const macStudio = await commission('mac-studio', 'trierarch');
    crewAboard(scene.core, { fleetId: scene.fleetId, shipId: macStudio });
    const crewedAt = scene.core.clock.now();
    scene.core.state.crewRequests.push({
      fleetId: scene.fleetId,
      shipId: docsWriter,
      settings: {},
      settingsVersion: 1,
      requestedAt: crewedAt,
      assignedTo: macStudio,
      status: 'crewing',
      reason: null,
      attempt: 0,
      sessionStartedAt: null,
      isFinal: false,
      givenBack: [],
    });
    await scene.send(scene.scout, { to: { kind: 'ship', shipId: docsWriter } });

    await expect(readHealth()).resolves.toMatchObject({
      stuck: [{ place: { kind: 'ship', ship: { name: 'docs-writer' }, machine: { id: macStudio, name: 'mac-studio', lastSeenAt: crewedAt } } }],
    });
  });

  it('places a delivery handed on a plain lease whose session went quiet for 10 minutes at its ship', async () => {
    const messageId = await scene.send(scene.lookout, { to: { kind: 'ship', shipId: scene.scout.shipId } });
    await scene.receive(scene.scout);
    const handedAt = scene.core.clock.now();
    scene.core.clock.advance(10 * MINUTE_MS);

    await expect(readHealth()).resolves.toMatchObject({
      stuck: [
        {
          cause: 'stalledInFlight',
          place: { kind: 'ship', ship: { id: scene.scout.shipId, name: 'scout' } },
          count: 1,
          oldestSince: handedAt,
          deliveries: [{ deliveryId: deliveryIdOf(scene.core, messageId), messageId, state: 'handed', since: handedAt }],
        },
      ],
    });
  });

  it('counts the deliveries stuck at each hour, replayed from the events', async () => {
    await scene.send(scene.scout, { to: { kind: 'type', type: 'planner' } });
    await lastPlannerRetires();
    scene.core.clock.advance(3 * HOUR_MS);

    const { stuckPerHour } = await readHealth();

    expect(stuckPerHour.slice(-5).map((hour) => hour.count)).toEqual([0, 1, 1, 1, 1]);
  });

  it('counts the deliveries acknowledged in the last 24 hours, with the median time from send to acknowledgement', async () => {
    const before = await scene.send(scene.scout, { to: { kind: 'type', type: 'planner' } });
    await scene.receive(scene.planner);
    await scene.ack(scene.planner, before);
    scene.core.clock.advance(25 * HOUR_MS);
    for (const waits of [0, 8 * SECOND_MS, 58 * SECOND_MS]) {
      const messageId = await scene.send(scene.scout, { to: { kind: 'type', type: 'planner' } });
      scene.core.clock.advance(waits);
      await scene.receive(scene.planner);
      await scene.ack(scene.planner, messageId);
    }

    const { acknowledged } = await readHealth();

    // The median is read from duration buckets under half a percent wide (performance design, decision 10).
    expect(acknowledged.count).toBe(3);
    expect(acknowledged.medianMs).toBeGreaterThan(0.995 * 10 * SECOND_MS);
    expect(acknowledged.medianMs).toBeLessThan(1.005 * 10 * SECOND_MS);
  });

  it('counts the deliveries acknowledged in each hour of the last 24, the last one ending now', async () => {
    const early = await scene.send(scene.scout, { to: { kind: 'type', type: 'planner' } });
    await scene.receive(scene.planner);
    await scene.ack(scene.planner, early);
    // Two and a half hours on: the early one falls in the third hour back.
    scene.core.clock.advance(2.5 * HOUR_MS);
    const late = await scene.send(scene.scout, { to: { kind: 'type', type: 'planner' } });
    await scene.receive(scene.planner);
    await scene.ack(scene.planner, late);

    const { perHour } = (await readHealth()).acknowledged;

    expect(perHour).toHaveLength(24);
    expect(perHour.at(-1)).toEqual({ at: scene.core.clock.now(), count: 1 });
    expect(perHour.map((hour) => hour.count)).toEqual([...Array.from({ length: 21 }, () => 0), 1, 0, 1]);
  });

  it('answers no median when nothing was acknowledged in the last 24 hours', async () => {
    await expect(readHealth()).resolves.toMatchObject({ acknowledged: { count: 0, medianMs: null } });
  });
});

describe('reading the fleet health from the stuck snapshot', () => {
  it('answers what the replay answers, each hour at its hour mark', async () => {
    await scene.send(scene.scout, { to: { kind: 'type', type: 'planner' } });
    await lastPlannerRetires();
    const acknowledged = await scene.send(scene.scout, { to: { kind: 'ship', shipId: scene.lookout.shipId } });
    await scene.receive(scene.lookout);
    await scene.ack(scene.lookout, acknowledged);
    scene.core.clock.set('2026-10-01T12:00:00.000Z');
    // As a fleet founded before the snapshot came reads it: replayed.
    scene.core.state.healthSnapshots.length = 0;
    const replayed = await readHealth();

    await closeSnapshot(scene.core);
    const fromSnapshot = await readHealth();

    expect(fromSnapshot.stuck).toEqual(replayed.stuck);
    expect(fromSnapshot.stuckPerHour.slice(0, -1)).toEqual(replayed.stuckPerHour.slice(1));
    expect(fromSnapshot.acknowledged.count).toBe(replayed.acknowledged.count);
  });

  it('folds what happened after the latest closed hour', async () => {
    scene.core.clock.set('2026-10-01T10:10:00.000Z');
    await closeSnapshot(scene.core);
    await scene.send(scene.scout, { to: { kind: 'type', type: 'planner' } });
    await lastPlannerRetires();

    const health = await readHealth();

    expect(health.stuck).toMatchObject([{ cause: 'noShipCanTake', count: 1 }]);
    expect(health.stuckPerHour.at(-2)).toEqual({ at: new Date('2026-10-01T10:00:00.000Z'), count: 0 });
  });
});

describe('reading the fleet health within read reach (decision 0034)', () => {
  let fleet: ReadReachScenario;

  beforeEach(async () => {
    fleet = await readReachScenario();
    await fleet.readRulesApply();
  });

  it('counts only the stuck deliveries whose message the caller reads, now and in the trend', async () => {
    await fleet.send(fleet.near, { kind: 'type', type: 'keeper' });
    await fleet.send(fleet.argo, { kind: 'type', type: 'keeper' });
    unwrap(await fleet.registry.retireShip(fleet.argo, { shipId: fleet.far.shipId }));

    const [read, all] = [await fleet.history.readHealth(fleet.reader), await fleet.history.readHealth(fleet.argo)];

    expect([read.stuck.map((place) => place.count), read.stuckPerHour.at(-1)?.count, all.stuck.map((place) => place.count)]).toEqual([[1], 1, [2]]);
  });

  it('counts only the stuck deliveries whose message the caller reads in each hour of the snapshot', async () => {
    await fleet.send(fleet.near, { kind: 'type', type: 'keeper' });
    await fleet.send(fleet.argo, { kind: 'type', type: 'keeper' });
    unwrap(await fleet.registry.retireShip(fleet.argo, { shipId: fleet.far.shipId }));
    await closeSnapshot(fleet.core);
    fleet.core.clock.advance(HOUR_MS);
    await closeSnapshot(fleet.core);

    const [read, all] = [await fleet.history.readHealth(fleet.reader), await fleet.history.readHealth(fleet.argo)];

    expect([read.stuckPerHour.at(-2)?.count, all.stuckPerHour.at(-2)?.count]).toEqual([1, 2]);
  });

  it('counts only the acknowledged deliveries whose message the caller reads', async () => {
    const toNear = await fleet.send(fleet.far, { kind: 'ship', shipId: fleet.near.shipId });
    const toFar = await fleet.send(fleet.argo, { kind: 'ship', shipId: fleet.far.shipId });
    for (const [crew, messageId] of [
      [fleet.near, toNear],
      [fleet.far, toFar],
    ] as const) {
      unwrap(await fleet.messaging.receiveDeliveries(crew, { max: 10 }));
      unwrap(await fleet.messaging.acknowledgeDelivery(crew, { deliveryId: deliveryIdOf(fleet.core, messageId) }));
    }

    const [read, all] = [await fleet.history.readHealth(fleet.reader), await fleet.history.readHealth(fleet.argo)];

    expect([read.acknowledged.count, all.acknowledged.count]).toEqual([1, 2]);
  });

  it("shows a ship outside the caller's read reach without the machine behind it, by name only", async () => {
    const macStudio = unwrap(await fleet.registry.commissionShip(fleet.argo, { idempotencyKey: newKey(), name: 'mac-studio', type: 'trierarch' })).shipId;
    fleet.core.state.crewRequests.push({
      fleetId: fleet.fleetId,
      shipId: fleet.far.shipId,
      settings: {},
      settingsVersion: 1,
      requestedAt: fleet.core.clock.now(),
      assignedTo: macStudio,
      status: 'crewing',
      reason: null,
      attempt: 0,
      sessionStartedAt: null,
      isFinal: false,
      givenBack: [],
    });
    await fleet.send(fleet.reader, { kind: 'ship', shipId: fleet.far.shipId });
    unwrap(await fleet.messaging.receiveDeliveries(fleet.far, { max: 10 }));
    fleet.core.clock.advance(10 * MINUTE_MS);

    const [read, all] = [await fleet.history.readHealth(fleet.reader), await fleet.history.readHealth(fleet.argo)];

    expect([read.stuck.map(({ place }) => place), all.stuck.map(({ place }) => place.kind === 'ship' && place.machine?.id)]).toEqual([
      [{ kind: 'ship', ship: { id: fleet.far.shipId, name: 'far' }, machine: null }],
      [macStudio],
    ]);
  });
});
