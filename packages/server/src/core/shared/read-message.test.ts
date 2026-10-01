import { beforeEach, describe, expect, it } from 'vitest';

import { historyScenario, type HistoryScenario } from '../../../test/support/history-scenario.js';
import { unwrap } from '../../../test/support/result.js';

let scene: HistoryScenario;

beforeEach(async () => {
  scene = await historyScenario();
});

describe('reading one message', () => {
  it('gives the envelope, the whole payload and the delivery with its history, newest first', async () => {
    const payload = '{"pr":48}';
    const messageId = await scene.send(scene.planner, { kind: 'ship', shipId: scene.scout.shipId }, { payload });
    const sentAt = scene.core.clock.now();
    await scene.receive(scene.scout);
    await scene.ack(scene.scout, messageId);

    const message = unwrap(await scene.history.readMessage(scene.argo, { messageId }));

    expect(message).toMatchObject({
      id: messageId,
      sender: { name: 'planner' },
      recipient: { kind: 'ship', ship: { name: 'scout' } },
      sentAt,
      contentType: 'text/plain',
      payload,
      delivery: { state: 'acknowledged', attempts: 1, claimedBy: { name: 'scout' } },
    });
    expect(message.delivery.history).toMatchObject([
      { type: 'DeliveryAcknowledged', ship: { name: 'scout' }, location: null },
      { type: 'DeliveryClaimed', ship: { name: 'scout' }, location: { kind: 'DEVICE', description: null }, attempts: 1 },
      { type: 'MessageAccepted', ship: null, location: null, attempts: null },
    ]);
  });

  it("keeps a type delivery's claims and its return to the queue when the claiming ship was released", async () => {
    const messageId = await scene.send(scene.planner, { kind: 'type', type: 'reviewer' });
    await scene.receive(scene.scout);
    unwrap(await scene.registry.releaseShip(scene.argo, { shipId: scene.scout.shipId }));
    await scene.receive(scene.lookout);

    const message = unwrap(await scene.history.readMessage(scene.argo, { messageId }));

    expect(message.delivery.history.map((entry) => [entry.type, entry.ship?.name ?? null, entry.attempts])).toEqual([
      ['DeliveryClaimed', 'lookout', 2],
      ['DeliveryReturned', 'scout', 1],
      ['DeliveryClaimed', 'scout', 1],
      ['MessageAccepted', null, null],
    ]);
  });

  it('knows no message of another fleet', async () => {
    const messageId = await scene.send(scene.planner, { kind: 'ship', shipId: scene.scout.shipId });
    const elsewhere = { ...scene.argo, fleetId: scene.core.ids('fleet') };

    await expect(scene.history.readMessage(elsewhere, { messageId })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'MESSAGE_NOT_FOUND' },
    });
  });
});
