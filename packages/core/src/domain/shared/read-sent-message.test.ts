import { beforeEach, describe, expect, it } from 'vitest';

import { deliveryIdOf } from '../../../test/support/core-fixtures.js';
import { historyScenario, type HistoryScenario } from '../../../test/support/history-scenario.js';
import { refusalOf, unwrap } from '../../../test/support/result.js';
import { createReadSentMessage, type ReadSentMessage } from './read-sent-message.js';

let scene: HistoryScenario;
let sentMessage: ReadSentMessage;

beforeEach(async () => {
  scene = await historyScenario();
  sentMessage = createReadSentMessage({ history: scene.core.history });
});

describe('a sender reading the delivery of a message it sent', () => {
  it('gives its recipient, and its delivery pending since it was sent, and no payload', async () => {
    const messageId = await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.scout.shipId }, payload: '{"pr":48}' });
    const sentAt = scene.core.clock.now();
    const deliveryId = deliveryIdOf(scene.core, messageId);

    expect(unwrap(await sentMessage(scene.planner, { messageId }))).toEqual({
      messageId,
      sentAt,
      recipient: { kind: 'ship', ship: { id: scene.scout.shipId, name: 'scout' } },
      delivery: { deliveryId, state: 'pending', since: sentAt },
    });
  });

  it('gives it handed since the receive that took it', async () => {
    const messageId = await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.scout.shipId } });
    await scene.receive(scene.scout);
    const receivedAt = scene.core.clock.now();

    expect(unwrap(await sentMessage(scene.planner, { messageId })).delivery).toMatchObject({ state: 'handed', since: receivedAt });
  });

  it('gives it acknowledged since the ack', async () => {
    const messageId = await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.scout.shipId } });
    await scene.receive(scene.scout);
    await scene.ack(scene.scout, messageId);
    const ackedAt = scene.core.clock.now();

    expect(unwrap(await sentMessage(scene.planner, { messageId })).delivery).toMatchObject({ state: 'acknowledged', since: ackedAt });
  });

  it('gives it pending again since its return, when the lease that held it ended', async () => {
    const messageId = await scene.send(scene.planner, { to: { kind: 'type', type: 'reviewer' } });
    await scene.receive(scene.scout);
    scene.core.clock.advance(5_000);
    unwrap(await scene.registry.releaseShip(scene.argo, { shipId: scene.scout.shipId }));
    const returnedAt = scene.core.clock.now();

    expect(unwrap(await sentMessage(scene.planner, { messageId }))).toMatchObject({
      recipient: { kind: 'type', type: 'reviewer' },
      delivery: { state: 'pending', since: returnedAt },
    });
  });

  it('refuses a message another ship sent as none, argo included, so its existence does not show', async () => {
    const messageId = await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.scout.shipId } });

    for (const caller of [scene.scout, scene.lookout, scene.argo]) {
      expect(refusalOf(await sentMessage(caller, { messageId }))).toEqual({ kind: 'MESSAGE_NOT_FOUND', message: `No message ${messageId} in this fleet` });
    }
  });

  it('refuses a message the fleet does not have', async () => {
    const messageId = scene.core.ids('message');

    expect(refusalOf(await sentMessage(scene.planner, { messageId }))).toEqual({ kind: 'MESSAGE_NOT_FOUND', message: `No message ${messageId} in this fleet` });
  });
});
