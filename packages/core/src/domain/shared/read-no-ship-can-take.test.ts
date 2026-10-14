import { beforeEach, describe, expect, it } from 'vitest';

import { deliveryIdOf } from '../../../test/support/core-fixtures.js';
import { historyScenario, type HistoryScenario } from '../../../test/support/history-scenario.js';
import { newKey } from '../../../test/support/keys.js';
import { unwrap } from '../../../test/support/result.js';

let scene: HistoryScenario;

beforeEach(async () => {
  scene = await historyScenario();
});

/** The planner, the last ship of its type, retires. */
async function lastPlannerRetires(): Promise<void> {
  unwrap(await scene.registry.retireShip(scene.argo, { shipId: scene.planner.shipId }));
}

describe('reading the deliveries no ship can take', () => {
  it('lists a pending delivery to a type whose last ship retired, with the type and its whole message', async () => {
    const payload = 'Plan https://github.com/ThomasHendrickx/aeolus-fleet/issues/304';
    const messageId = await scene.send(scene.scout, { to: { kind: 'type', type: 'planner' }, payload });
    const sentAt = scene.core.clock.now();
    await lastPlannerRetires();

    await expect(scene.history.readNoShipCanTake(scene.argo)).resolves.toEqual([
      {
        deliveryId: deliveryIdOf(scene.core, messageId),
        type: 'planner',
        message: {
          id: messageId,
          sender: { id: scene.scout.shipId, name: 'scout' },
          recipient: { kind: 'type', type: 'planner' },
          inReplyTo: null,
          sentAt,
          contentType: 'text/plain',
          model: 'claude-opus-5-5',
          isPing: false,
          payload,
        },
      },
    ]);
  });

  it('lists none a ship of the type can take', async () => {
    await scene.send(scene.scout, { to: { kind: 'type', type: 'planner' } });

    await expect(scene.history.readNoShipCanTake(scene.argo)).resolves.toEqual([]);
  });

  it('clears by itself once a ship of the type is commissioned', async () => {
    await scene.send(scene.scout, { to: { kind: 'type', type: 'planner' } });
    await lastPlannerRetires();
    unwrap(await scene.registry.commissionShip(scene.argo, { idempotencyKey: newKey(), name: 'planner-2', type: 'planner' }));

    await expect(scene.history.readNoShipCanTake(scene.argo)).resolves.toEqual([]);
  });

  it('lists a type delivery whose reachable ships all retired, though a ship of the type is active', async () => {
    const messageId = await scene.send(scene.planner, { to: { kind: 'type', type: 'reviewer' } });
    const deliveryId = deliveryIdOf(scene.core, messageId);
    // Network rules let the sender reach scout only (decision 0034).
    scene.core.state.deliveries = scene.core.state.deliveries.map((delivery) => (delivery.id === deliveryId ? { ...delivery, reachableShipIds: [scene.scout.shipId] } : delivery));
    unwrap(await scene.registry.retireShip(scene.argo, { shipId: scene.scout.shipId }));

    await expect(scene.history.readNoShipCanTake(scene.argo)).resolves.toMatchObject([{ deliveryId, type: 'reviewer' }]);
  });

  it('lists them oldest first and leaves out one a ship took', async () => {
    const taken = await scene.send(scene.scout, { to: { kind: 'type', type: 'planner' } });
    await scene.receive(scene.planner);
    await scene.ack(scene.planner, taken);
    const first = await scene.send(scene.scout, { to: { kind: 'type', type: 'planner' } });
    const second = await scene.send(scene.lookout, { to: { kind: 'type', type: 'planner' } });
    await lastPlannerRetires();

    const listed = await scene.history.readNoShipCanTake(scene.argo);

    expect(listed.map((entry) => entry.message.id)).toEqual([first, second]);
  });
});
