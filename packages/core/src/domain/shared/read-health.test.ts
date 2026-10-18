import { beforeEach, describe, expect, it } from 'vitest';

import { crewAboard, deliveryIdOf } from '../../../test/support/core-fixtures.js';
import { historyScenario, type HistoryScenario } from '../../../test/support/history-scenario.js';
import { newKey } from '../../../test/support/keys.js';
import { unwrap } from '../../../test/support/result.js';
import { readReachScenario, type ReadReachScenario } from '../../../test/support/read-reach-scenario.js';

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

    await expect(readHealth()).resolves.toMatchObject({ acknowledged: { count: 3, medianMs: 10 * SECOND_MS } });
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
});
