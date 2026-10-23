import { beforeEach, describe, expect, it } from 'vitest';

import { deliveryIdOf } from '../../../test/support/core-fixtures.js';
import { historyScenario, type HistoryScenario } from '../../../test/support/history-scenario.js';
import { readReachScenario } from '../../../test/support/read-reach-scenario.js';
import type { InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../testing/result.js';
import { createCloseHealthSnapshots } from './close-health-snapshots.js';

const SECOND_MS = 1000;
const HOUR_MS = 60 * 60 * SECOND_MS;

let scene: HistoryScenario;

beforeEach(async () => {
  scene = await historyScenario();
});

async function closeSnapshot(core: InMemoryCore): Promise<void> {
  await createCloseHealthSnapshots({ fleets: core.fleets, uow: core.uow, clock: core.clock })();
}

/** Sends to a planner, which acknowledges it `waitMs` later. */
async function acknowledgedAfter(waitMs: number): Promise<void> {
  const messageId = await scene.send(scene.scout, { to: { kind: 'type', type: 'planner' } });
  scene.core.clock.advance(waitMs);
  await scene.receive(scene.planner);
  await scene.ack(scene.planner, messageId);
}

describe('reading the acknowledged in the last 24 hours', () => {
  it('answers none and no median when nothing was acknowledged', async () => {
    const acknowledged = await scene.history.readAcknowledged(scene.argo);

    expect([acknowledged.count, acknowledged.medianMs, acknowledged.perHour.every((hour) => hour.count === 0)]).toEqual([0, null, true]);
  });

  it('counts the deliveries acknowledged in the last 24 hours, with the median time from send to acknowledgement', async () => {
    await acknowledgedAfter(0);
    scene.core.clock.advance(25 * HOUR_MS);
    for (const waitMs of [0, 8 * SECOND_MS, 58 * SECOND_MS]) {
      await acknowledgedAfter(waitMs);
    }

    const acknowledged = await scene.history.readAcknowledged(scene.argo);

    // Each wait is 2 seconds longer: the receive and the acknowledgement take a second each. The
    // median is read from duration buckets under half a percent wide (performance design, decision 10).
    expect(acknowledged.count).toBe(3);
    expect(acknowledged.medianMs).toBeGreaterThan(0.995 * 10 * SECOND_MS);
    expect(acknowledged.medianMs).toBeLessThan(1.005 * 10 * SECOND_MS);
  });

  it('counts each hour of the last 24 from the snapshot, the last one ending now', async () => {
    scene.core.clock.set('2026-10-01T09:30:00.000Z');
    await acknowledgedAfter(0);
    scene.core.clock.set('2026-10-01T10:10:00.000Z');
    await closeSnapshot(scene.core);
    await acknowledgedAfter(0);

    const { perHour, count } = await scene.history.readAcknowledged(scene.argo);

    expect([count, perHour.length, perHour.slice(-2)]).toEqual([
      2,
      24,
      [
        { at: new Date('2026-10-01T10:00:00.000Z'), count: 1 },
        { at: scene.core.clock.now(), count: 1 },
      ],
    ]);
  });

  it('counts only the acknowledged deliveries whose message the caller reads (decision 0034)', async () => {
    const fleet = await readReachScenario();
    await fleet.readRulesApply();
    const toNear = await fleet.send(fleet.far, { kind: 'ship', shipId: fleet.near.shipId });
    const toFar = await fleet.send(fleet.argo, { kind: 'ship', shipId: fleet.far.shipId });
    for (const [crew, messageId] of [
      [fleet.near, toNear],
      [fleet.far, toFar],
    ] as const) {
      unwrap(await fleet.messaging.receiveDeliveries(crew, { max: 10 }));
      unwrap(await fleet.messaging.acknowledgeDelivery(crew, { deliveryId: deliveryIdOf(fleet.core, messageId) }));
    }

    const counts = [(await fleet.history.readAcknowledged(fleet.reader)).count, (await fleet.history.readAcknowledged(fleet.argo)).count];

    expect(counts).toEqual([1, 2]);
  });
});
