import { beforeEach, describe, expect, it } from 'vitest';

import { historyScenario, type HistoryScenario } from '../../../test/support/history-scenario.js';
import { readReachScenario } from '../../../test/support/read-reach-scenario.js';
import type { InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';
import { createCloseHealthSnapshots } from './close-health-snapshots.js';

const MINUTE_MS = 60 * 1000;

let scene: HistoryScenario;

beforeEach(async () => {
  scene = await historyScenario();
});

async function closeSnapshot(core: InMemoryCore): Promise<void> {
  await createCloseHealthSnapshots({ fleets: core.fleets, uow: core.uow, clock: core.clock })();
}

describe('reading the stuck count', () => {
  it('answers none stuck and no oldest while deliveries move', async () => {
    const messageId = await scene.send(scene.scout, { to: { kind: 'type', type: 'planner' } });
    await scene.receive(scene.planner);
    await scene.ack(scene.planner, messageId);

    await expect(scene.history.readStuckCount(scene.argo)).resolves.toEqual({ count: 0, oldestSince: null });
  });

  it('counts the stuck deliveries of every cause and place, since when the oldest waits', async () => {
    await scene.send(scene.scout, { to: { kind: 'type', type: 'planner' } });
    const firstSentAt = scene.core.clock.now();
    unwrap(await scene.registry.retireShip(scene.argo, { shipId: scene.planner.shipId }));
    scene.core.clock.advance(MINUTE_MS);
    const docsWriter = unwrap(await scene.registry.commissionShip(scene.argo, { idempotencyKey: newKey(), name: 'docs-writer', type: 'writer' })).shipId;
    await scene.send(scene.lookout, { to: { kind: 'ship', shipId: docsWriter } });
    await scene.send(scene.scout, { to: { kind: 'ship', shipId: docsWriter } });

    await expect(scene.history.readStuckCount(scene.argo)).resolves.toEqual({ count: 3, oldestSince: firstSentAt });
  });

  it('counts what happened after the latest closed hour of the snapshot', async () => {
    scene.core.clock.set('2026-10-01T10:10:00.000Z');
    await closeSnapshot(scene.core);
    await scene.send(scene.scout, { to: { kind: 'type', type: 'planner' } });
    unwrap(await scene.registry.retireShip(scene.argo, { shipId: scene.planner.shipId }));

    // The scenario's send takes a second.
    await expect(scene.history.readStuckCount(scene.argo)).resolves.toEqual({ count: 1, oldestSince: new Date('2026-10-01T10:10:01.000Z') });
  });

  it('counts only the stuck deliveries whose message the caller reads (decision 0034)', async () => {
    const fleet = await readReachScenario();
    await fleet.readRulesApply();
    await fleet.send(fleet.near, { kind: 'type', type: 'keeper' });
    await fleet.send(fleet.argo, { kind: 'type', type: 'keeper' });
    unwrap(await fleet.registry.retireShip(fleet.argo, { shipId: fleet.far.shipId }));

    const counts = [(await fleet.history.readStuckCount(fleet.reader)).count, (await fleet.history.readStuckCount(fleet.argo)).count];

    expect(counts).toEqual([1, 2]);
  });
});
