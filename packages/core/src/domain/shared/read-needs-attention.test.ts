import type { MessageId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { historyScenario, type HistoryScenario } from '../../../test/support/history-scenario.js';
import { unwrap } from '../../../test/support/result.js';
import type { Crew } from './caller.js';

/** The claim that makes a delivery never acknowledged undeliverable (docs/blueprint.md, "Key flows"). */
const UNDELIVERABLE_AT_CLAIM = 5;

let scene: HistoryScenario;

beforeEach(async () => {
  scene = await historyScenario();
});

/** Has the crew receive until its claims made what it held undeliverable. */
async function receiveUntilUndeliverable(crew: Crew): Promise<void> {
  for (let claim = 1; claim <= UNDELIVERABLE_AT_CLAIM; claim += 1) {
    await scene.receive(crew);
  }
}

function deliveryOf(messageId: MessageId) {
  return scene.core.state.deliveries.find((held) => held.messageId === messageId);
}

describe('reading Needs attention', () => {
  it('lists an undeliverable delivery with its whole message, its claims and since when', async () => {
    const payload = '{"run":"e2e","ref":"pr-320"}';
    const messageId = await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.scout.shipId }, payload });
    const sentAt = scene.core.clock.now();
    await receiveUntilUndeliverable(scene.scout);
    // Each receive comes a second after the one before; the fifth claim made it undeliverable.
    const since = new Date(sentAt.getTime() + UNDELIVERABLE_AT_CLAIM * 1_000);

    await expect(scene.history.readNeedsAttention(scene.argo)).resolves.toEqual([
      {
        deliveryId: deliveryOf(messageId)?.id,
        attempts: UNDELIVERABLE_AT_CLAIM,
        since,
        message: {
          id: messageId,
          sender: { id: scene.planner.shipId, name: 'planner' },
          recipient: { kind: 'ship', ship: { id: scene.scout.shipId, name: 'scout' } },
          inReplyTo: null,
          sentAt,
          contentType: 'text/plain',
          isPing: false,
          model: 'claude-opus-5-5',
          payload,
        },
      },
    ]);
  });

  it('tells an undeliverable ping by its message', async () => {
    const { messageId } = unwrap(await scene.messaging.pingShip(scene.argo, { shipId: scene.scout.shipId }));
    await receiveUntilUndeliverable(scene.scout);

    const [undeliverable] = await scene.history.readNeedsAttention(scene.argo);

    expect(undeliverable?.message).toMatchObject({ id: messageId, isPing: true });
  });

  it('lists the oldest first, by when each became undeliverable', async () => {
    const first = await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.scout.shipId } });
    await receiveUntilUndeliverable(scene.scout);
    const second = await scene.send(scene.planner, { to: { kind: 'type', type: 'reviewer' } });
    await receiveUntilUndeliverable(scene.lookout);

    const listed = await scene.history.readNeedsAttention(scene.argo);

    expect(listed.map((entry) => entry.message.id)).toEqual([first, second]);
    expect(listed[1]?.message.recipient).toEqual({ kind: 'type', type: 'reviewer' });
  });

  it('leaves out every delivery that is not undeliverable: dismissed, abandoned, pending and acknowledged ones', async () => {
    const dismissed = await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.scout.shipId } });
    await receiveUntilUndeliverable(scene.scout);
    const deliveryId = deliveryOf(dismissed)?.id;
    expect(deliveryId).toBeDefined();
    if (deliveryId) {
      unwrap(await scene.messaging.dismissDelivery(scene.argo, { deliveryId }));
    }
    const acknowledged = await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.scout.shipId } });
    await scene.receive(scene.scout);
    await scene.ack(scene.scout, acknowledged);
    await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.lookout.shipId } });
    await scene.send(scene.scout, { to: { kind: 'ship', shipId: scene.planner.shipId } });
    unwrap(await scene.registry.retireShip(scene.argo, { shipId: scene.lookout.shipId }));

    await expect(scene.history.readNeedsAttention(scene.argo)).resolves.toEqual([]);
  });

  it('names each ship by the name it has now', async () => {
    const messageId = await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.scout.shipId } });
    await receiveUntilUndeliverable(scene.scout);
    const planner = scene.core.state.ships.find((ship) => ship.id === scene.planner.shipId);
    if (planner) {
      planner.name = 'release-planner';
    }

    const [entry] = await scene.history.readNeedsAttention(scene.argo);

    expect(entry?.message).toMatchObject({ id: messageId, sender: { name: 'release-planner' } });
  });

  it("knows nothing of another fleet's deliveries", async () => {
    await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.scout.shipId } });
    await receiveUntilUndeliverable(scene.scout);
    const elsewhere = { ...scene.argo, fleetId: scene.core.ids('fleet') };

    await expect(scene.history.readNeedsAttention(elsewhere)).resolves.toEqual([]);
  });
});
