import { beforeEach, describe, expect, it } from 'vitest';

import type { MessageId } from '@aeolus-fleet/common';

import { agentCaller, deliveryIdOf } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { historyScenario, type HistoryScenario } from '../../../test/support/history-scenario.js';
import { newKey } from '../../../test/support/keys.js';
import { unwrap } from '../../../test/support/result.js';
import type { Crew } from './caller.js';

let scene: HistoryScenario;

beforeEach(async () => {
  scene = await historyScenario();
});

describe('reading one message', () => {
  it('gives the envelope, the whole payload and the delivery with its history, newest first', async () => {
    const payload = '{"pr":48}';
    const messageId = await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.scout.shipId }, payload });
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
      model: 'claude-opus-5-5',
      payload,
      delivery: { state: 'acknowledged', attempts: 1, claimedBy: { name: 'scout' } },
    });
    expect(message.delivery.history).toMatchObject([
      { type: 'DeliveryAcknowledged', ship: { name: 'scout' }, location: null, harness: null },
      { type: 'DeliveryHanded', ship: { name: 'scout' }, location: { kind: 'DEVICE', description: null }, harness: 'claude-code', attempts: 1 },
      { type: 'MessageAccepted', ship: null, location: null, harness: null, attempts: null },
    ]);
  });

  it("keeps a type delivery's claims and its return to the queue when the claiming ship was released", async () => {
    const messageId = await scene.send(scene.planner, { to: { kind: 'type', type: 'reviewer' } });
    await scene.receive(scene.scout);
    unwrap(await scene.registry.releaseShip(scene.argo, { shipId: scene.scout.shipId }));
    await scene.receive(scene.lookout);

    const message = unwrap(await scene.history.readMessage(scene.argo, { messageId }));

    expect(message.delivery.history.map((entry) => [entry.type, entry.ship?.name ?? null, entry.attempts])).toEqual([
      ['DeliveryHanded', 'lookout', 2],
      ['DeliveryReturned', 'scout', 1],
      ['DeliveryHanded', 'scout', 1],
      ['MessageAccepted', null, null],
    ]);
  });

  it('knows no message of another fleet', async () => {
    const messageId = await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.scout.shipId } });
    const elsewhere = { ...scene.argo, fleetId: scene.core.ids('fleet') };

    await expect(scene.history.readMessage(elsewhere, { messageId })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'MESSAGE_NOT_FOUND' },
    });
  });
});

describe("reading a message's way through", () => {
  const TEN_MINUTES = 10 * 60_000;

  const read = async (messageId: MessageId) => unwrap(await scene.history.readMessage(scene.argo, { messageId }));
  const deliveryOf = (messageId: MessageId) => deliveryIdOf(scene.core, messageId);
  const pushReceive = async (crew: Crew) => {
    scene.core.clock.advance(1_000);
    unwrap(await scene.messaging.pushReceiveDeliveries(crew, {}));
  };
  const handOver = async (crew: Crew, messageId: MessageId, handOverNumber: number, isOnceMore = false) => {
    scene.core.clock.advance(1_000);
    unwrap(await scene.messaging.handOverDelivery(crew, { deliveryId: deliveryOf(messageId), handOverNumber, isOnceMore }));
  };
  const toScout = () => scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.scout.shipId } });

  /** The trierarch on mac-mini, and builder crewed by it from the starting prompt it got. */
  async function crewedByTrierarch(): Promise<{ trierarch: Crew; builder: Crew }> {
    const { registry, argo, core } = scene;
    const plugin = await shipWithScopes({ registry, argo }, { name: 'trierarch-plugin', type: 'plugin', scopes: ['crew:assign'] });
    const trierarch = await shipWithScopes({ registry, argo }, { name: 'mac-mini', type: 'trierarch', scopes: ['crew:run'] });
    const { shipId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'builder', type: 'builder' }));
    unwrap(await registry.requestCrew(argo, { shipId, settings: { harness: 'claude-code' } }));
    unwrap(await registry.assignCrew(plugin, { shipId, trierarchShipId: trierarch.shipId }));
    const { secret } = unwrap(await registry.getStartingPrompt(trierarch, { shipId }));
    core.clock.advance(1_000);
    unwrap(await registry.claimShip({ shipId, secret, location: { kind: 'DEVICE' }, harness: 'claude-code' }));
    const lease = core.state.leases.find((held) => held.shipId === shipId && held.endedAt === null);
    if (!lease) {
      throw new Error('builder was not crewed');
    }
    return { trierarch: { ...trierarch, leaseId: lease.id }, builder: { ...agentCaller({ fleetId: scene.fleetId, shipId }), leaseId: lease.id } };
  }

  it('names the plugin watcher that received it and handed it over on a session crewed by hand, each step with its number', async () => {
    const messageId = await toScout();
    await pushReceive(scene.scout);
    await pushReceive(scene.scout);
    await handOver(scene.scout, messageId, 1);
    await scene.ack(scene.scout, messageId);
    unwrap(await scene.messaging.reportHandled(scene.scout, { deliveryId: deliveryOf(messageId) }));

    const { delivery } = await read(messageId);

    expect(delivery.history.map((step) => [step.type, step.by?.kind ?? null, step.handOverNumber, step.isAgain])).toEqual([
      ['DeliveryHandled', null, null, false],
      ['DeliveryAcknowledged', null, null, false],
      ['DeliveryHanded', 'pluginWatcher', 1, false],
      ['DeliveryReceived', 'pluginWatcher', null, true],
      ['DeliveryReceived', 'pluginWatcher', null, false],
      ['MessageAccepted', null, null, false],
    ]);
    expect(delivery.way).toMatchObject({ holder: null, isPulled: false, lease: { by: { kind: 'pluginWatcher' }, isEnded: false } });
  });

  it('holds a received delivery with the trierarch on its computer that received it', async () => {
    const { builder } = await crewedByTrierarch();
    const messageId = await scene.send(scene.planner, { to: { kind: 'ship', shipId: builder.shipId } });
    await pushReceive(builder);

    const { delivery } = await read(messageId);

    expect(delivery.way.holder).toEqual({ kind: 'trierarch', trierarch: { id: expect.any(String), name: 'mac-mini' } });
    expect(delivery.history[0]).toMatchObject({ type: 'DeliveryReceived', by: { kind: 'trierarch', trierarch: { name: 'mac-mini' } } });
  });

  it('gives the crew its trierarch runs, restarting with its restart', async () => {
    const { trierarch, builder } = await crewedByTrierarch();
    const messageId = await scene.send(scene.planner, { to: { kind: 'ship', shipId: builder.shipId } });
    await pushReceive(builder);
    unwrap(await scene.registry.reportCrewStatus(trierarch, { shipId: builder.shipId, status: 'restarting', attempt: 2 }));

    const { delivery } = await read(messageId);

    expect(delivery.way.crew).toEqual({ status: 'restarting', attempt: 2, startedAt: null });
  });

  it('gives no crew for a session crewed by hand', async () => {
    const messageId = await toScout();
    await pushReceive(scene.scout);

    expect((await read(messageId)).delivery.way.crew).toBeNull();
  });

  it('gives the turn of the pushed lease a pending delivery waits for', async () => {
    await pushReceive(scene.scout);
    const busyAt = scene.core.clock.now();
    unwrap(await scene.registry.reportTurn(scene.scout, { turn: 'busy', at: busyAt }));
    const messageId = await toScout();

    const { delivery } = await read(messageId);

    expect(delivery.way).toMatchObject({ holder: { kind: 'fleet' }, lease: { by: { kind: 'pluginWatcher' }, turn: { state: 'busy', at: busyAt } } });
  });

  it('waits for no lease when it is to a type', async () => {
    const messageId = await scene.send(scene.planner, { to: { kind: 'type', type: 'reviewer' } });

    expect((await read(messageId)).delivery.way).toMatchObject({ holder: { kind: 'fleet' }, lease: null });
  });

  it('gives the overdue clock argo was told of while it stands, and the step it was told at', async () => {
    const messageId = await toScout();
    await pushReceive(scene.scout);
    await handOver(scene.scout, messageId, 1);
    scene.core.clock.advance(TEN_MINUTES);
    await scene.messaging.tellOverdueDeliveries();

    const { delivery } = await read(messageId);

    expect(delivery.way.overdue).toEqual({ clock: 'notConfirmed', minutes: 10, toldAt: scene.core.clock.now() });
    expect(delivery.history[0]).toMatchObject({ type: 'DeliveryOverdue', overdue: { clock: 'notConfirmed', minutes: 10 } });
  });

  it('gives no overdue clock once the delivery moved on', async () => {
    const messageId = await toScout();
    await pushReceive(scene.scout);
    await handOver(scene.scout, messageId, 1);
    scene.core.clock.advance(TEN_MINUTES);
    await scene.messaging.tellOverdueDeliveries();
    await scene.ack(scene.scout, messageId);

    expect((await read(messageId)).delivery.way.overdue).toBeNull();
  });

  it('tells a delivery a plain receive handed, pulled, on a lease with no computer side', async () => {
    const messageId = await toScout();
    await scene.receive(scene.scout);
    await scene.ack(scene.scout, messageId);

    expect((await read(messageId)).delivery.way).toMatchObject({ holder: { kind: 'agent' }, isPulled: true, lease: { by: null } });
  });

  it('tells an acknowledged delivery whose lease ended', async () => {
    const messageId = await toScout();
    await pushReceive(scene.scout);
    await handOver(scene.scout, messageId, 1);
    await scene.ack(scene.scout, messageId);
    unwrap(await scene.registry.releaseShip(scene.argo, { shipId: scene.scout.shipId }));

    expect((await read(messageId)).delivery.way).toMatchObject({ holder: { kind: 'agent' }, lease: { isEnded: true } });
  });

  it('names why the lease ended when the delivery went back to pending', async () => {
    const messageId = await toScout();
    await pushReceive(scene.scout);
    unwrap(await scene.registry.releaseShip(scene.argo, { shipId: scene.scout.shipId }));

    const { delivery } = await read(messageId);

    expect(delivery.history[0]).toMatchObject({ type: 'DeliveryReturned', leaseEnd: 'released' });
    expect(delivery.way.holder).toEqual({ kind: 'fleet' });
  });

  it('tells the hand-over once more after its turn died, and not handled after a second death', async () => {
    const messageId = await toScout();
    await pushReceive(scene.scout);
    await handOver(scene.scout, messageId, 1);
    await scene.ack(scene.scout, messageId);
    await handOver(scene.scout, messageId, 2, true);
    unwrap(await scene.messaging.reportNotHandled(scene.scout, { deliveryId: deliveryOf(messageId) }));

    const { delivery } = await read(messageId);

    expect(delivery.history.slice(0, 2)).toMatchObject([
      { type: 'DeliveryNotHandled', ship: { name: 'scout' } },
      { type: 'DeliveryHanded', handOverNumber: 2, isOnceMore: true, by: { kind: 'pluginWatcher' } },
    ]);
    expect(delivery.way.holder).toBeNull();
  });

  it('gives the replies to it, oldest first', async () => {
    const messageId = await toScout();
    await scene.send(scene.scout, { to: { kind: 'ship', shipId: scene.planner.shipId }, inReplyTo: messageId });
    await scene.send(scene.lookout, { to: { kind: 'ship', shipId: scene.planner.shipId }, inReplyTo: messageId });

    const { replies } = await read(messageId);

    expect(replies.map((reply) => reply.sender.name)).toEqual(['scout', 'lookout']);
  });
});
