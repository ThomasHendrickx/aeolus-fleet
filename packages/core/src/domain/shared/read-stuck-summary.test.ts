import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { crewAboard } from '../../../test/support/core-fixtures.js';
import { historyScenario, type HistoryScenario } from '../../../test/support/history-scenario.js';
import { readReachScenario } from '../../../test/support/read-reach-scenario.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';

let scene: HistoryScenario;

beforeEach(async () => {
  scene = await historyScenario();
});

async function commission(name: string, type: string): Promise<ShipId> {
  return unwrap(await scene.registry.commissionShip(scene.argo, { idempotencyKey: newKey(), name, type })).shipId;
}

/** The ship's crew request is assigned to the machine's trierarch. */
function assignedTo(shipId: ShipId, machine: ShipId): void {
  scene.core.state.crewRequests.push({
    fleetId: scene.fleetId,
    shipId,
    settings: {},
    settingsVersion: 1,
    requestedAt: scene.core.clock.now(),
    assignedTo: machine,
    status: 'crewing',
    reason: null,
    attempt: 0,
    sessionStartedAt: null,
    isFinal: false,
    givenBack: [],
  });
}

describe('reading the stuck summary', () => {
  it('answers none stuck, no places, no oldest, no cause and no machine while deliveries move', async () => {
    const messageId = await scene.send(scene.scout, { to: { kind: 'type', type: 'planner' } });
    await scene.receive(scene.planner);
    await scene.ack(scene.planner, messageId);

    await expect(scene.history.readStuckSummary(scene.argo)).resolves.toEqual({ count: 0, places: 0, oldestSince: null, byCause: [], byMachine: [] });
  });

  it('counts the stuck deliveries and their places in all and per cause, in the causes order, since when the oldest waits', async () => {
    await scene.send(scene.scout, { to: { kind: 'type', type: 'planner' } });
    const firstSentAt = scene.core.clock.now();
    unwrap(await scene.registry.retireShip(scene.argo, { shipId: scene.planner.shipId }));
    const docsWriter = await commission('docs-writer', 'writer');
    const reviewer = await commission('copy-editor', 'editor');
    await scene.send(scene.scout, { to: { kind: 'ship', shipId: docsWriter } });
    await scene.send(scene.lookout, { to: { kind: 'ship', shipId: docsWriter } });
    await scene.send(scene.scout, { to: { kind: 'ship', shipId: reviewer } });

    await expect(scene.history.readStuckSummary(scene.argo)).resolves.toEqual({
      count: 4,
      places: 3,
      oldestSince: firstSentAt,
      byCause: [
        { cause: 'noShipCanTake', count: 1, places: 1 },
        { cause: 'waitingForCrew', count: 3, places: 2 },
      ],
      byMachine: [],
    });
  });

  it('counts the stuck deliveries per machine behind their ships', async () => {
    const macStudio = await commission('mac-studio', 'trierarch');
    crewAboard(scene.core, { fleetId: scene.fleetId, shipId: macStudio });
    const docsWriter = await commission('docs-writer', 'writer');
    const copyEditor = await commission('copy-editor', 'editor');
    assignedTo(docsWriter, macStudio);
    assignedTo(copyEditor, macStudio);
    await scene.send(scene.scout, { to: { kind: 'ship', shipId: docsWriter } });
    await scene.send(scene.lookout, { to: { kind: 'ship', shipId: docsWriter } });
    await scene.send(scene.scout, { to: { kind: 'ship', shipId: copyEditor } });

    await expect(scene.history.readStuckSummary(scene.argo)).resolves.toMatchObject({ byMachine: [{ machine: { id: macStudio, name: 'mac-studio' }, count: 3 }] });
  });

  it('counts only the stuck deliveries whose message the caller reads (decision 0034)', async () => {
    const fleet = await readReachScenario();
    await fleet.readRulesApply();
    await fleet.send(fleet.near, { kind: 'type', type: 'keeper' });
    await fleet.send(fleet.argo, { kind: 'type', type: 'keeper' });
    unwrap(await fleet.registry.retireShip(fleet.argo, { shipId: fleet.far.shipId }));

    const counts = [(await fleet.history.readStuckSummary(fleet.reader)).count, (await fleet.history.readStuckSummary(fleet.argo)).count];

    expect(counts).toEqual([1, 2]);
  });
});
