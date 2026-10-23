import { beforeEach, describe, expect, it } from 'vitest';

import { crewAboard, deliveryIdOf } from '../../../test/support/core-fixtures.js';
import { historyScenario, type HistoryScenario } from '../../../test/support/history-scenario.js';
import { readReachScenario } from '../../../test/support/read-reach-scenario.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';

const MINUTE_MS = 60 * 1000;

let scene: HistoryScenario;

beforeEach(async () => {
  scene = await historyScenario();
});

async function commission(name: string, type: string) {
  return unwrap(await scene.registry.commissionShip(scene.argo, { idempotencyKey: newKey(), name, type })).shipId;
}

describe('reading the stuck deliveries by cause and place', () => {
  it('answers none while deliveries move', async () => {
    const messageId = await scene.send(scene.scout, { to: { kind: 'type', type: 'planner' } });
    await scene.receive(scene.planner);
    await scene.ack(scene.planner, messageId);

    await expect(scene.history.readStuck(scene.argo, {})).resolves.toEqual({ items: [], nextCursor: null });
  });

  it('places a delivery handed on a quiet plain lease at its ship, with the delivery and since when it waits', async () => {
    const messageId = await scene.send(scene.lookout, { to: { kind: 'ship', shipId: scene.scout.shipId } });
    await scene.receive(scene.scout);
    const handedAt = scene.core.clock.now();
    scene.core.clock.advance(10 * MINUTE_MS);

    await expect(scene.history.readStuck(scene.argo, {})).resolves.toEqual({
      items: [
      {
        cause: 'stalledInFlight',
        place: { kind: 'ship', ship: { id: scene.scout.shipId, name: 'scout' }, machine: null },
        count: 1,
        oldestSince: handedAt,
        deliveries: [{ deliveryId: deliveryIdOf(scene.core, messageId), messageId, state: 'handed', since: handedAt }],
      },
      ],
      nextCursor: null,
    });
  });

  it('names the machine whose trierarch its crew request is assigned to', async () => {
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

    await expect(scene.history.readStuck(scene.argo, {})).resolves.toMatchObject({
      items: [{ cause: 'waitingForCrew', place: { kind: 'ship', ship: { name: 'docs-writer' }, machine: { id: macStudio, name: 'mac-studio', lastSeenAt: crewedAt } } }],
    });
  });

  it('counts only the stuck deliveries whose message the caller reads (decision 0034)', async () => {
    const fleet = await readReachScenario();
    await fleet.readRulesApply();
    await fleet.send(fleet.near, { kind: 'type', type: 'keeper' });
    await fleet.send(fleet.argo, { kind: 'type', type: 'keeper' });
    unwrap(await fleet.registry.retireShip(fleet.argo, { shipId: fleet.far.shipId }));

    const counts = [(await fleet.history.readStuck(fleet.reader, {})).items.map((place) => place.count), (await fleet.history.readStuck(fleet.argo, {})).items.map((place) => place.count)];

    expect(counts).toEqual([[1], [2]]);
  });

  it('answers the places a page at a time, oldest waiting first, each page after the cursor the last one answered', async () => {
    const places = [await commission('first', 'writer'), await commission('second', 'writer'), await commission('third', 'writer')];
    for (const shipId of places) {
      await scene.send(scene.scout, { to: { kind: 'ship', shipId } });
    }

    const firstPage = await scene.history.readStuck(scene.argo, { limit: 2 });
    const lastPage = await scene.history.readStuck(scene.argo, { limit: 2, cursor: firstPage.nextCursor ?? undefined });

    expect([...firstPage.items, ...lastPage.items].map(({ place }) => place.kind === 'ship' && place.ship.name)).toEqual(['first', 'second', 'third']);
    expect(lastPage.nextCursor).toBeNull();
  });

  it('answers a full last page with no cursor after it', async () => {
    await scene.send(scene.scout, { to: { kind: 'ship', shipId: await commission('first', 'writer') } });

    await expect(scene.history.readStuck(scene.argo, { limit: 1 })).resolves.toMatchObject({ nextCursor: null });
  });

  it('answers only the places of the cause asked', async () => {
    await scene.send(scene.scout, { to: { kind: 'ship', shipId: await commission('docs-writer', 'writer') } });
    await scene.send(scene.scout, { to: { kind: 'type', type: 'planner' } });
    unwrap(await scene.registry.retireShip(scene.argo, { shipId: scene.planner.shipId }));

    const { items } = await scene.history.readStuck(scene.argo, { cause: 'noShipCanTake' });

    expect(items.map(({ cause, place }) => [cause, place])).toEqual([['noShipCanTake', { kind: 'type', type: 'planner' }]]);
  });
});
