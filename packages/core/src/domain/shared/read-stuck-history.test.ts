import { beforeEach, describe, expect, it } from 'vitest';

import { historyScenario, type HistoryScenario } from '../../../test/support/history-scenario.js';
import { readReachScenario } from '../../../test/support/read-reach-scenario.js';
import type { InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../testing/result.js';
import { createCloseHealthSnapshots } from './close-health-snapshots.js';

const HOUR_MS = 60 * 60 * 1000;

let scene: HistoryScenario;

beforeEach(async () => {
  scene = await historyScenario();
});

async function closeSnapshot(core: InMemoryCore): Promise<void> {
  await createCloseHealthSnapshots({ fleets: core.fleets, uow: core.uow, clock: core.clock })();
}

async function lastPlannerRetires(): Promise<void> {
  unwrap(await scene.registry.retireShip(scene.argo, { shipId: scene.planner.shipId }));
}

describe('reading the stuck history', () => {
  it('answers every hour of the last 7 days at none while deliveries move, the last one now', async () => {
    const messageId = await scene.send(scene.scout, { to: { kind: 'type', type: 'planner' } });
    await scene.receive(scene.planner);
    await scene.ack(scene.planner, messageId);

    const history = await scene.history.readStuckHistory(scene.argo);

    expect(history).toHaveLength(168);
    expect(history.every((hour) => hour.count === 0)).toBe(true);
    expect(history.at(-1)?.at).toEqual(scene.core.clock.now());
  });

  it('counts the deliveries stuck at each hour, replayed from the events', async () => {
    await scene.send(scene.scout, { to: { kind: 'type', type: 'planner' } });
    await lastPlannerRetires();
    scene.core.clock.advance(3 * HOUR_MS);

    const history = await scene.history.readStuckHistory(scene.argo);

    expect(history.slice(-5).map((hour) => hour.count)).toEqual([0, 1, 1, 1, 1]);
  });

  it('counts each closed hour of the snapshot at its hour mark, and stuck now last', async () => {
    scene.core.clock.set('2026-10-01T10:10:00.000Z');
    await closeSnapshot(scene.core);
    await scene.send(scene.scout, { to: { kind: 'type', type: 'planner' } });
    await lastPlannerRetires();
    scene.core.clock.set('2026-10-01T12:30:00.000Z');
    await closeSnapshot(scene.core);

    const history = await scene.history.readStuckHistory(scene.argo);

    expect(history.slice(-4)).toEqual([
      { at: new Date('2026-10-01T10:00:00.000Z'), count: 0 },
      { at: new Date('2026-10-01T11:00:00.000Z'), count: 1 },
      { at: new Date('2026-10-01T12:00:00.000Z'), count: 1 },
      { at: new Date('2026-10-01T12:30:00.000Z'), count: 1 },
    ]);
  });

  it('counts only the stuck deliveries whose message the caller reads (decision 0034)', async () => {
    const fleet = await readReachScenario();
    await fleet.readRulesApply();
    await fleet.send(fleet.near, { kind: 'type', type: 'keeper' });
    await fleet.send(fleet.argo, { kind: 'type', type: 'keeper' });
    unwrap(await fleet.registry.retireShip(fleet.argo, { shipId: fleet.far.shipId }));
    await closeSnapshot(fleet.core);
    fleet.core.clock.advance(HOUR_MS);
    await closeSnapshot(fleet.core);

    const counts = [(await fleet.history.readStuckHistory(fleet.reader)).at(-2)?.count, (await fleet.history.readStuckHistory(fleet.argo)).at(-2)?.count];

    expect(counts).toEqual([1, 2]);
  });
});
