import type { DeliveryId, MessageId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { deliveryIdOf } from '../../../test/support/core-fixtures.js';
import { historyScenario, type HistoryScenario } from '../../../test/support/history-scenario.js';
import { unwrap } from '../../testing/result.js';
import type { Crew } from './caller.js';
import { readReachScenario, type ReadReachScenario } from '../../../test/support/read-reach-scenario.js';

/** The claim that makes a delivery never acknowledged undeliverable (docs/blueprint.md, "Key flows"). */
const UNDELIVERABLE_AT_ATTEMPT = 5;

let scene: HistoryScenario;

beforeEach(async () => {
  scene = await historyScenario();
});

/** Has the crew receive until its claims made what it held undeliverable. */
async function receiveUntilUndeliverable(crew: Crew): Promise<void> {
  for (let claim = 1; claim <= UNDELIVERABLE_AT_ATTEMPT; claim += 1) {
    await scene.receive(crew);
  }
}

function deliveryOf(messageId: MessageId) {
  return scene.core.state.deliveries.find((held) => held.messageId === messageId);
}

/**
 * Has the pushed crew's computer side take the message and hand it over, the
 * hook acknowledge it, hand it once more after its turn died, and report it
 * not handled when that turn died too. Answers the delivery's id.
 */
async function notHandled(crew: Crew, report: { messageId: MessageId; reason?: string }): Promise<DeliveryId> {
  const { messageId, reason } = report;
  const deliveryId = deliveryIdOf(scene.core, messageId);
  const { messaging } = scene;
  unwrap(await messaging.pushReceiveDeliveries(crew, {}));
  unwrap(await messaging.handOverDelivery(crew, { deliveryId, handOverNumber: 1 }));
  unwrap(await messaging.acknowledgeDelivery(crew, { deliveryId }));
  unwrap(await messaging.handOverDelivery(crew, { deliveryId, handOverNumber: 2, isOnceMore: true }));
  scene.core.clock.advance(1_000);
  unwrap(await messaging.reportNotHandled(crew, reason === undefined ? { deliveryId } : { deliveryId, reason }));
  return deliveryId;
}

/** The first page of Needs attention as argo reads it. */
async function needsAttentionOf() {
  return (await scene.history.readNeedsAttention(scene.argo, {}).then(unwrap)).items;
}

describe('reading Needs attention', () => {
  it('lists an undeliverable delivery with its whole message, its claims and since when', async () => {
    const payload = '{"run":"e2e","ref":"pr-320"}';
    const messageId = await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.scout.shipId }, payload });
    const sentAt = scene.core.clock.now();
    await receiveUntilUndeliverable(scene.scout);
    // Each receive comes a second after the one before; the fifth claim made it undeliverable.
    const since = new Date(sentAt.getTime() + UNDELIVERABLE_AT_ATTEMPT * 1_000);

    await expect(needsAttentionOf()).resolves.toEqual([
      {
        deliveryId: deliveryOf(messageId)?.id,
        state: 'undeliverable',
        attempts: UNDELIVERABLE_AT_ATTEMPT,
        isPushed: false,
        since,
        reason: null,
        ship: { id: scene.scout.shipId, name: 'scout' },
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

    const [undeliverable] = await needsAttentionOf();

    expect(undeliverable?.message).toMatchObject({ id: messageId, isPing: true });
  });

  it('lists the oldest first, by when each became undeliverable', async () => {
    const first = await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.scout.shipId } });
    await receiveUntilUndeliverable(scene.scout);
    const second = await scene.send(scene.planner, { to: { kind: 'type', type: 'reviewer' } });
    await receiveUntilUndeliverable(scene.lookout);

    const listed = await needsAttentionOf();

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

    await expect(needsAttentionOf()).resolves.toEqual([]);
  });

  it('tells an undeliverable delivery a pushed crew handed over again and again, by its hand-over numbers', async () => {
    const messageId = await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.scout.shipId } });
    const deliveryId = deliveryIdOf(scene.core, messageId);
    unwrap(await scene.messaging.pushReceiveDeliveries(scene.scout, {}));
    for (let handOverNumber = 1; handOverNumber <= UNDELIVERABLE_AT_ATTEMPT; handOverNumber += 1) {
      unwrap(await scene.messaging.handOverDelivery(scene.scout, { deliveryId, handOverNumber }));
    }

    const [entry] = await needsAttentionOf();

    expect(entry).toMatchObject({ deliveryId, state: 'undeliverable', attempts: UNDELIVERABLE_AT_ATTEMPT, isPushed: true });
  });

  it('names the ship whose turn did not handle it, for its ship page', async () => {
    const messageId = await scene.send(scene.planner, { to: { kind: 'type', type: 'reviewer' } });
    await notHandled(scene.lookout, { messageId });

    const [entry] = await needsAttentionOf();

    expect(entry).toMatchObject({ state: 'notHandled', ship: { id: scene.lookout.shipId, name: 'lookout' } });
  });

  it('lists a delivery not handled, with its attempts and since when it was not handled', async () => {
    const messageId = await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.scout.shipId } });
    const deliveryId = await notHandled(scene.scout, { messageId });

    const [entry] = await needsAttentionOf();

    expect(entry).toMatchObject({
      deliveryId,
      state: 'notHandled',
      attempts: 1,
      since: scene.core.clock.now(),
      message: { id: messageId, sender: { name: 'planner' }, isPing: false },
    });
  });

  it('lists a delivery not handled with the reason its crew gave (#847)', async () => {
    const messageId = await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.scout.shipId } });
    await notHandled(scene.scout, { messageId, reason: 'the turn it was handed once more to died too' });

    const [entry] = await needsAttentionOf();

    expect(entry).toMatchObject({ state: 'notHandled', reason: 'the turn it was handed once more to died too' });
  });

  it('lists a delivery not handled without a reason when its crew gave none (#847)', async () => {
    const messageId = await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.scout.shipId } });
    await notHandled(scene.scout, { messageId });

    const [entry] = await needsAttentionOf();

    expect(entry).toMatchObject({ state: 'notHandled', reason: null });
  });

  it('lists undeliverable and not handled deliveries together, oldest first by since when', async () => {
    const undeliverable = await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.lookout.shipId } });
    const notHandledFirst = await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.scout.shipId } });
    await notHandled(scene.scout, { messageId: notHandledFirst });
    await receiveUntilUndeliverable(scene.lookout);
    const notHandledLast = await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.scout.shipId } });
    await notHandled(scene.scout, { messageId: notHandledLast });

    const listed = await needsAttentionOf();

    expect(listed.map((entry) => [entry.message.id, entry.state])).toEqual([
      [notHandledFirst, 'notHandled'],
      [undeliverable, 'undeliverable'],
      [notHandledLast, 'notHandled'],
    ]);
  });

  it('leaves out a handled delivery: the turn that took it ended by itself', async () => {
    const messageId = await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.scout.shipId } });
    const deliveryId = deliveryIdOf(scene.core, messageId);
    unwrap(await scene.messaging.pushReceiveDeliveries(scene.scout, {}));
    unwrap(await scene.messaging.acknowledgeDelivery(scene.scout, { deliveryId }));
    unwrap(await scene.messaging.reportHandled(scene.scout, { deliveryId }));

    await expect(needsAttentionOf()).resolves.toEqual([]);
  });

  it('names each ship by the name it has now', async () => {
    const messageId = await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.scout.shipId } });
    await receiveUntilUndeliverable(scene.scout);
    const planner = scene.core.state.ships.find((ship) => ship.id === scene.planner.shipId);
    if (planner) {
      planner.name = 'release-planner';
    }

    const [entry] = await needsAttentionOf();

    expect(entry?.message).toMatchObject({ id: messageId, sender: { name: 'release-planner' } });
  });

  it('answers a page at a time, oldest first, each after the cursor of the last', async () => {
    const sent: MessageId[] = [];
    for (let index = 0; index < 3; index += 1) {
      sent.push(await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.scout.shipId } }));
      await receiveUntilUndeliverable(scene.scout);
    }
    const read = (cursor?: DeliveryId) => scene.history.readNeedsAttention(scene.argo, { limit: 2, cursor }).then(unwrap);

    const first = await read();
    const second = await read(first.nextCursor ?? undefined);

    expect([first.items.map((entry) => entry.message.id), first.nextCursor]).toEqual([sent.slice(0, 2), first.items[1]?.deliveryId]);
    expect([second.items.map((entry) => entry.message.id), second.nextCursor]).toEqual([sent.slice(2), null]);
  });

  it('goes on after a cursor whose delivery was dismissed since', async () => {
    const first = await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.scout.shipId } });
    await receiveUntilUndeliverable(scene.scout);
    const second = await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.scout.shipId } });
    await receiveUntilUndeliverable(scene.scout);
    const page = await scene.history.readNeedsAttention(scene.argo, { limit: 1 }).then(unwrap);
    unwrap(await scene.messaging.dismissDelivery(scene.argo, { deliveryId: deliveryIdOf(scene.core, first) }));

    const next = await scene.history.readNeedsAttention(scene.argo, { limit: 1, cursor: page.nextCursor ?? undefined }).then(unwrap);

    expect(next.items.map((entry) => entry.message.id)).toEqual([second]);
  });

  it("lists only a ship's own when asked for its page: those whose turn or claims it was", async () => {
    await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.scout.shipId } });
    await receiveUntilUndeliverable(scene.scout);
    const lookouts = await scene.send(scene.planner, { to: { kind: 'type', type: 'reviewer' } });
    await notHandled(scene.lookout, { messageId: lookouts });

    const page = await scene.history.readNeedsAttention(scene.argo, { shipId: scene.lookout.shipId }).then(unwrap);

    expect(page.items.map((entry) => entry.message.id)).toEqual([lookouts]);
  });

  it('lists only the deliveries in the state asked, for a ship page that shows its not handled ones', async () => {
    await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.lookout.shipId } });
    await receiveUntilUndeliverable(scene.lookout);
    const lookouts = await scene.send(scene.planner, { to: { kind: 'type', type: 'reviewer' } });
    await notHandled(scene.lookout, { messageId: lookouts });

    const page = await scene.history.readNeedsAttention(scene.argo, { shipId: scene.lookout.shipId, state: 'notHandled' }).then(unwrap);

    expect(page.items.map((entry) => [entry.message.id, entry.state])).toEqual([[lookouts, 'notHandled']]);
  });

  it("knows nothing of another fleet's deliveries", async () => {
    await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.scout.shipId } });
    await receiveUntilUndeliverable(scene.scout);
    const elsewhere = { ...scene.argo, fleetId: scene.core.ids('fleet') };

    await expect(scene.history.readNeedsAttention(elsewhere, {}).then(unwrap).then(({ items }) => items)).resolves.toEqual([]);
  });
});

describe('reading Needs attention within read reach (decision 0034)', () => {
  let fleet: ReadReachScenario;

  beforeEach(async () => {
    fleet = await readReachScenario();
    await fleet.readRulesApply();
  });

  it('lists only the deliveries whose message the caller reads', async () => {
    const toNear = await fleet.send(fleet.argo, { kind: 'ship', shipId: fleet.near.shipId });
    await fleet.send(fleet.argo, { kind: 'ship', shipId: fleet.far.shipId });
    for (let claim = 1; claim <= UNDELIVERABLE_AT_ATTEMPT; claim += 1) {
      fleet.core.clock.advance(1_000);
      unwrap(await fleet.messaging.receiveDeliveries(fleet.near, { max: 10 }));
      unwrap(await fleet.messaging.receiveDeliveries(fleet.far, { max: 10 }));
    }

    const [read, all] = [(await fleet.history.readNeedsAttention(fleet.reader, {}).then(unwrap)).items, (await fleet.history.readNeedsAttention(fleet.argo, {}).then(unwrap)).items];

    expect([read.map((entry) => entry.message.id), all.length]).toEqual([[toNear], 2]);
  });

  it('pages past the deliveries it leaves out: a page can come short, with the cursor of the last it read', async () => {
    await fleet.send(fleet.argo, { kind: 'ship', shipId: fleet.far.shipId });
    const toNear = await fleet.send(fleet.argo, { kind: 'ship', shipId: fleet.near.shipId });
    for (let claim = 1; claim <= UNDELIVERABLE_AT_ATTEMPT; claim += 1) {
      fleet.core.clock.advance(1_000);
      unwrap(await fleet.messaging.receiveDeliveries(fleet.far, { max: 10 }));
      unwrap(await fleet.messaging.receiveDeliveries(fleet.near, { max: 10 }));
    }
    const first = await fleet.history.readNeedsAttention(fleet.reader, { limit: 1 }).then(unwrap);

    const next = await fleet.history.readNeedsAttention(fleet.reader, { limit: 1, cursor: first.nextCursor ?? undefined }).then(unwrap);

    expect([first.items.length, next.items.map((entry) => entry.message.id)]).toEqual([0, [toNear]]);
  });
});
