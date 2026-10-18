import { beforeEach, describe, expect, it } from 'vitest';

import { deliveryIdOf } from '../../../test/support/core-fixtures.js';
import { historyScenario, type HistoryScenario } from '../../../test/support/history-scenario.js';
import { unwrap } from '../../../test/support/result.js';
import { PREVIEW_LENGTH } from './read-ship-messages.js';
import { readReachScenario, type ReadReachScenario } from '../../../test/support/read-reach-scenario.js';

let scene: HistoryScenario;

beforeEach(async () => {
  scene = await historyScenario();
});

async function messagesOf(shipId = scene.scout.shipId) {
  return unwrap(await scene.history.readShipMessages(scene.argo, { shipId }));
}

describe("reading a ship's messages", () => {
  it('gives the messages it sent and was sent, newest first, with their parties and delivery now', async () => {
    const asked = await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.scout.shipId } });
    await scene.receive(scene.scout);
    await scene.ack(scene.scout, asked);
    const answered = await scene.send(scene.scout, { to: { kind: 'ship', shipId: scene.planner.shipId }, inReplyTo: asked });

    const messages = await messagesOf();

    expect(messages).toMatchObject([
      {
        id: answered,
        sender: { id: scene.scout.shipId, name: 'scout' },
        recipient: { kind: 'ship', ship: { id: scene.planner.shipId, name: 'planner' } },
        inReplyTo: asked,
        model: 'claude-opus-5-5',
        delivery: { state: 'pending', claimedBy: null },
      },
      {
        id: asked,
        sender: { id: scene.planner.shipId, name: 'planner' },
        inReplyTo: null,
        delivery: { state: 'acknowledged', claimedBy: { id: scene.scout.shipId, name: 'scout' } },
      },
    ]);
  });

  it("leaves out other ships' messages", async () => {
    await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.lookout.shipId } });

    await expect(messagesOf()).resolves.toEqual([]);
  });

  it('shows a message to a type to its sender and to each ship that claimed it, and to no other ship of the type', async () => {
    const messageId = await scene.send(scene.planner, { to: { kind: 'type', type: 'reviewer' } });
    await expect(messagesOf()).resolves.toEqual([]);
    await scene.receive(scene.scout);
    unwrap(await scene.registry.releaseShip(scene.argo, { shipId: scene.scout.shipId }));
    await scene.receive(scene.lookout);

    await expect(messagesOf(scene.planner.shipId)).resolves.toMatchObject([{ id: messageId }]);
    await expect(messagesOf(scene.scout.shipId)).resolves.toMatchObject([{ id: messageId }]);
    await expect(messagesOf(scene.lookout.shipId)).resolves.toMatchObject([
      { id: messageId, delivery: { state: 'handed', claimedBy: { name: 'lookout' } } },
    ]);
  });

  it(`previews the payload on one line, at most ${String(PREVIEW_LENGTH)} characters`, async () => {
    const payload = `Review\n\n  the pull request   ${'x'.repeat(PREVIEW_LENGTH)}`;
    await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.scout.shipId }, payload });

    const [message] = await messagesOf();

    expect(message?.preview).toBe(`Review the pull request ${'x'.repeat(PREVIEW_LENGTH)}`.slice(0, PREVIEW_LENGTH));
  });

  it("tells a delivery a pushed crew's computer side handed over from one a plain receive handed (pulled)", async () => {
    const pushed = await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.scout.shipId } });
    unwrap(await scene.messaging.pushReceiveDeliveries(scene.scout, {}));
    unwrap(await scene.messaging.handOverDelivery(scene.scout, { deliveryId: deliveryIdOf(scene.core, pushed), handOverNumber: 1, isOnceMore: false }));
    const pulled = await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.lookout.shipId } });
    await scene.receive(scene.lookout);
    const waiting = await scene.send(scene.lookout, { to: { kind: 'ship', shipId: scene.planner.shipId } });

    const listed = await messagesOf(scene.planner.shipId);

    expect(listed.map(({ id, delivery }) => [id, delivery.state, delivery.isPulled])).toEqual([
      [waiting, 'pending', false],
      [pulled, 'handed', true],
      [pushed, 'handed', false],
    ]);
  });

  it('knows no ship of another fleet', async () => {
    const elsewhere = { ...scene.argo, fleetId: scene.core.ids('fleet') };

    await expect(scene.history.readShipMessages(elsewhere, { shipId: scene.scout.shipId })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'SHIP_NOT_FOUND' },
    });
  });
});

describe("reading the messages of a ship outside read reach (decision 0034)", () => {
  let fleet: ReadReachScenario;

  beforeEach(async () => {
    fleet = await readReachScenario();
    await fleet.readRulesApply();
  });

  it('lists only the messages it reads through the other side', async () => {
    const withNear = await fleet.send(fleet.far, { kind: 'ship', shipId: fleet.near.shipId });
    await fleet.send(fleet.far, { kind: 'ship', shipId: fleet.argo.shipId });
    await fleet.send(fleet.argo, { kind: 'type', type: 'keeper' });

    const listed = unwrap(await fleet.history.readShipMessages(fleet.reader, { shipId: fleet.far.shipId }));

    expect(listed.map((message) => message.id)).toEqual([withNear]);
  });

  it('lists every message of a ship within read reach', async () => {
    const sent = [await fleet.send(fleet.near, { kind: 'ship', shipId: fleet.far.shipId }), await fleet.send(fleet.argo, { kind: 'ship', shipId: fleet.near.shipId })];

    const listed = unwrap(await fleet.history.readShipMessages(fleet.reader, { shipId: fleet.near.shipId }));

    expect(listed.map((message) => message.id)).toEqual(sent.toReversed());
  });
});
