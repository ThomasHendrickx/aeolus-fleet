import { PING_CONTENT_TYPE, type FleetId, type MessageId, type ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  crewAboard,
  deliveryIdOf,
  initialiseFleet,
  messagingUseCases,
  operatorCaller,
  registryUseCases,
} from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import type { Caller, Crew } from '../shared/caller.js';
import { PING_PAYLOAD } from './ping-ship.js';

let core: InMemoryCore;
let useCases: ReturnType<typeof messagingUseCases>;
let fleetId: FleetId;
let argo: Caller;
let scoutId: ShipId;
let scout: Crew;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-02T09:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  ({ shipId: scoutId } = unwrap(await registryUseCases(core).commissionShip(argo, { name: 'scout', type: 'reviewer' })));
  scout = crewAboard(core, { fleetId, shipId: scoutId });
  useCases = messagingUseCases(core);
  core.clock.advance(60_000);
});

function storedMessage(messageId: MessageId) {
  return core.state.messages.find((held) => held.id === messageId);
}

function storedDelivery(messageId: MessageId) {
  return core.state.deliveries.find((held) => held.messageId === messageId);
}

/** Pings the scout and has its session receive the ping: in flight with it. */
async function pingInFlight(): Promise<{ messageId: MessageId }> {
  const { messageId } = unwrap(await useCases.pingShip(argo, { shipId: scoutId }));
  unwrap(await useCases.receiveDeliveries(scout, {}));
  return { messageId };
}

describe('pinging a ship', () => {
  it('sends a crewed ship a ping from argo: the reserved content type and the fixed payload, pending for that ship', async () => {
    const { messageId } = unwrap(await useCases.pingShip(argo, { shipId: scoutId }));

    expect(storedMessage(messageId)).toMatchObject({
      senderShipId: argo.shipId,
      selector: { kind: 'ship', shipId: scoutId },
      contentType: PING_CONTENT_TYPE,
      payload: PING_PAYLOAD,
    });
    expect(storedDelivery(messageId)).toMatchObject({ recipient: { kind: 'ship', shipId: scoutId }, state: 'pending' });
  });

  it('answers the new ping, when it was sent, and that this call sent it', async () => {
    const pinged = unwrap(await useCases.pingShip(argo, { shipId: scoutId }));

    expect(pinged).toEqual({ messageId: core.state.messages.at(-1)?.id, sentAt: core.clock.now(), isNew: true });
  });

  it('says the fixed payload: what the session does with a ping', () => {
    expect(PING_PAYLOAD).toBe('Ping from argo: answer with pong(deliveryId).');
  });

  it('writes MessageAccepted, caused by argo, on the ship timeline, and wakes its receivers', async () => {
    const { messageId } = unwrap(await useCases.pingShip(argo, { shipId: scoutId }));

    expect(core.state.events.filter((event) => event.messageId === messageId)).toEqual([
      expect.objectContaining({ type: 'MessageAccepted', actor: { kind: 'ship', shipId: argo.shipId }, shipId: scoutId }),
    ]);
    expect(core.state.notices).toContainEqual(
      expect.objectContaining({ deliveryId: deliveryIdOf(core, messageId), recipient: { kind: 'ship', shipId: scoutId } }),
    );
  });
});

describe('at most one open ping per ship', () => {
  it('answers the ping already waiting instead of sending another, and stores nothing', async () => {
    const first = unwrap(await useCases.pingShip(argo, { shipId: scoutId }));
    const sentAt = core.clock.now();
    core.clock.advance(180_000);
    const before = structuredClone(core.state);

    const again = unwrap(await useCases.pingShip(argo, { shipId: scoutId }));

    expect(again).toEqual({ messageId: first.messageId, sentAt, isNew: false });
    expect(core.state).toEqual(before);
  });

  it('answers the ping the session received but did not answer yet', async () => {
    const { messageId } = await pingInFlight();

    await expect(useCases.pingShip(argo, { shipId: scoutId })).resolves.toMatchObject({
      isOk: true,
      value: { messageId, isNew: false },
    });
  });

  it('sends a new ping once the ship answered the last one with pong', async () => {
    const { messageId } = await pingInFlight();
    unwrap(await useCases.answerPing(scout, { deliveryId: deliveryIdOf(core, messageId) }));

    const next = unwrap(await useCases.pingShip(argo, { shipId: scoutId }));

    expect(next).toMatchObject({ isNew: true });
    expect(next.messageId).not.toBe(messageId);
  });

  it('sends a new ping once the ship acknowledged the last one without pong', async () => {
    const { messageId } = await pingInFlight();
    unwrap(await useCases.acknowledgeDelivery(scout, { deliveryId: deliveryIdOf(core, messageId) }));

    await expect(useCases.pingShip(argo, { shipId: scoutId })).resolves.toMatchObject({ isOk: true, value: { isNew: true } });
  });

  it('sends a new ping once the last one went to the operator as undeliverable', async () => {
    const { messageId } = await pingInFlight();
    for (let claim = 2; claim <= 5; claim += 1) {
      unwrap(await useCases.receiveDeliveries(scout, {}));
    }
    expect(storedDelivery(messageId)).toMatchObject({ state: 'undeliverable' });

    await expect(useCases.pingShip(argo, { shipId: scoutId })).resolves.toMatchObject({ isOk: true, value: { isNew: true } });
  });

  it('does not take an ordinary message to the ship for an open ping', async () => {
    unwrap(
      await useCases.sendMessage(argo, {
        selector: { kind: 'ship', shipId: scoutId },
        payload: 'Review PR 76',
        idempotencyKey: 'review-76',
      }),
    );

    await expect(useCases.pingShip(argo, { shipId: scoutId })).resolves.toMatchObject({ isOk: true, value: { isNew: true } });
  });

  it("keeps one ship's open ping from holding back a ping to another", async () => {
    unwrap(await useCases.pingShip(argo, { shipId: scoutId }));
    const { shipId: lookoutId } = unwrap(
      await registryUseCases(core).commissionShip(argo, { name: 'lookout', type: 'reviewer' }),
    );
    crewAboard(core, { fleetId, shipId: lookoutId });

    await expect(useCases.pingShip(argo, { shipId: lookoutId })).resolves.toMatchObject({ isOk: true, value: { isNew: true } });
  });
});

describe('a ping refused', () => {
  async function expectRefused(shipId: ShipId, kind: string): Promise<void> {
    const before = structuredClone(core.state);

    await expect(useCases.pingShip(argo, { shipId })).resolves.toMatchObject({ isOk: false, error: { kind } });

    expect(core.state).toEqual(before);
  }

  it('refuses a ship awaiting crew: no session would answer', async () => {
    const { shipId } = unwrap(await registryUseCases(core).commissionShip(argo, { name: 'lookout', type: 'reviewer' }));

    await expectRefused(shipId, 'SHIP_NOT_CREWED');
  });

  it('refuses a retired ship', async () => {
    unwrap(await registryUseCases(core).retireShip(argo, { shipId: scoutId }));

    await expectRefused(scoutId, 'SHIP_ALREADY_RETIRED');
  });

  it('refuses argo: the console is no session to ping', async () => {
    await expectRefused(argo.shipId, 'OPERATOR_SHIP_IS_NOT_PINGED');
  });

  it('refuses a ship the fleet does not have', async () => {
    await expectRefused(core.ids('ship'), 'SHIP_NOT_FOUND');
  });
});
