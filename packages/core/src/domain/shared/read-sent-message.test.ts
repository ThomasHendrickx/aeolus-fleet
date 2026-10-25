import { beforeEach, describe, expect, it } from 'vitest';

import { deliveryIdOf } from '../../../test/support/core-fixtures.js';
import { valueIdOf } from '../../../test/support/label-fixtures.js';
import { historyScenario, type HistoryScenario } from '../../../test/support/history-scenario.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import type { Crew } from './caller.js';
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
      deliveries: [{ deliveryId, ship: { id: scene.scout.shipId, name: 'scout' }, state: 'pending', since: sentAt }],
    });
  });

  it('gives it handed since the receive that took it', async () => {
    const messageId = await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.scout.shipId } });
    await scene.receive(scene.scout);
    const receivedAt = scene.core.clock.now();

    expect(unwrap(await sentMessage(scene.planner, { messageId })).deliveries).toMatchObject([{ state: 'handed', since: receivedAt }]);
  });

  it('gives it acknowledged since the ack', async () => {
    const messageId = await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.scout.shipId } });
    await scene.receive(scene.scout);
    await scene.ack(scene.scout, messageId);
    const ackedAt = scene.core.clock.now();

    expect(unwrap(await sentMessage(scene.planner, { messageId })).deliveries).toMatchObject([{ state: 'acknowledged', since: ackedAt }]);
  });

  it('gives it pending again since its return, when the lease that held it ended', async () => {
    const messageId = await scene.send(scene.planner, { to: { kind: 'type', type: 'reviewer' } });
    await scene.receive(scene.scout);
    scene.core.clock.advance(5_000);
    unwrap(await scene.registry.releaseShip(scene.argo, { shipId: scene.scout.shipId }));
    const returnedAt = scene.core.clock.now();

    expect(unwrap(await sentMessage(scene.planner, { messageId }))).toMatchObject({
      recipient: { kind: 'type', type: 'reviewer' },
      deliveries: [{ ship: null, state: 'pending', since: returnedAt }],
    });
  });

  it('names the ship of the type that claimed it', async () => {
    const messageId = await scene.send(scene.planner, { to: { kind: 'type', type: 'reviewer' } });
    await scene.receive(scene.scout);

    expect(unwrap(await sentMessage(scene.planner, { messageId })).deliveries).toMatchObject([{ ship: { id: scene.scout.shipId, name: 'scout' }, state: 'handed' }]);
  });

  it('gives every delivery of a send to a label, each with its ship and where it stands, and the selection as sent (decision 0065)', async () => {
    unwrap(await scene.registry.defineLabel(scene.argo, { key: 'team', values: ['a'] }));
    const teamA = valueIdOf(scene.core, { key: 'team', value: 'a' });
    for (const crew of [scene.scout, scene.lookout, scene.planner]) {
      unwrap(await scene.registry.assignLabel(scene.argo, { shipId: crew.shipId, valueId: teamA }));
    }
    const messageId = await scene.send(scene.argo, { to: { kind: 'label', valueIds: [teamA] } });
    const sentAt = scene.core.clock.now();
    await scene.receive(scene.scout);
    const handedAt = scene.core.clock.now();
    await scene.receive(scene.lookout);
    await scene.ack(scene.lookout, messageId);
    const ackedAt = scene.core.clock.now();
    const deliveryTo = (crew: Crew) =>
      scene.core.state.deliveries.find((held) => held.messageId === messageId && held.recipient.kind === 'ship' && held.recipient.shipId === crew.shipId)?.id;

    expect(unwrap(await sentMessage(scene.argo, { messageId }))).toEqual({
      messageId,
      sentAt,
      recipient: { kind: 'label', valueIds: [teamA] },
      deliveries: [
        { deliveryId: deliveryTo(scene.scout), ship: { id: scene.scout.shipId, name: 'scout' }, state: 'handed', since: handedAt },
        { deliveryId: deliveryTo(scene.lookout), ship: { id: scene.lookout.shipId, name: 'lookout' }, state: 'acknowledged', since: ackedAt },
        { deliveryId: deliveryTo(scene.planner), ship: { id: scene.planner.shipId, name: 'planner' }, state: 'pending', since: sentAt },
      ],
    });
  });

  it('refuses a message another ship sent as none, argo included, so its existence does not show', async () => {
    const messageId = await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.scout.shipId } });

    for (const caller of [scene.scout, scene.lookout, scene.argo]) {
      expect(refusalOf(await sentMessage(caller, { messageId }))).toEqual({ kind: 'MESSAGE_NOT_FOUND', message: `No message ${messageId} in this fleet, or it is no longer kept` });
    }
  });

  it('refuses a message the fleet does not have', async () => {
    const messageId = scene.core.ids('message');

    expect(refusalOf(await sentMessage(scene.planner, { messageId }))).toEqual({ kind: 'MESSAGE_NOT_FOUND', message: `No message ${messageId} in this fleet, or it is no longer kept` });
  });
});
