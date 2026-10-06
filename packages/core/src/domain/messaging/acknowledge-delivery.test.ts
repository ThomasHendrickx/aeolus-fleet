import type { DeliveryId, FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  addAgentShip,
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
import type { Selector } from '../shared/selector.js';
import { newKey } from '../../../test/support/keys.js';

let core: InMemoryCore;
let useCases: ReturnType<typeof messagingUseCases>;
let fleetId: FleetId;
let argo: Caller;
let scoutId: ShipId;
let scout: Crew;
let lookout: Crew;

beforeEach(async () => {
  core = createInMemoryCore('2026-09-30T12:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  const { commissionShip } = registryUseCases(core);
  ({ shipId: scoutId } = unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })));
  const { shipId: lookoutId } = unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'lookout', type: 'reviewer' }));
  scout = crewAboard(core, { fleetId, shipId: scoutId });
  lookout = crewAboard(core, { fleetId, shipId: lookoutId });
  useCases = messagingUseCases(core);
  core.clock.advance(60_000);
});

/** Sends a plain-text message from argo and returns its delivery's id. */
async function sendTo(selector: Selector): Promise<DeliveryId> {
  const { messageId } = unwrap(
    await useCases.sendMessage(argo, {
      selector,
      payload: 'Review https://github.com/ThomasHendrickx/aeolus-fleet/pull/25',
      contentType: 'text/plain',
      idempotencyKey: `review-${core.ids('message')}`,
    }),
  );
  return deliveryIdOf(core, messageId);
}

/** Sends a delivery to the crew's ship and has the crew receive it: in flight, held by that ship. */
async function inFlightWith(crew: Crew, selector: Selector = { kind: 'ship', shipId: crew.shipId }): Promise<DeliveryId> {
  const deliveryId = await sendTo(selector);
  const { deliveries } = unwrap(await useCases.receiveDeliveries(crew, {}));
  expect(deliveries.map((delivery) => delivery.deliveryId)).toEqual([deliveryId]);
  core.state.events.length = 0;
  return deliveryId;
}

function stored(deliveryId: DeliveryId) {
  return core.state.deliveries.find((held) => held.id === deliveryId);
}

describe('acknowledging a delivery', () => {
  it('moves a delivery the ship holds in flight to acknowledged, and keeps who acknowledged it', async () => {
    const deliveryId = await inFlightWith(scout);

    await expect(useCases.acknowledgeDelivery(scout, { deliveryId })).resolves.toEqual({ isOk: true, value: undefined });
    expect(stored(deliveryId)).toMatchObject({
      state: 'acknowledged',
      claimedByShipId: scoutId,
      claimedByLeaseId: scout.leaseId,
      attempts: 1,
    });
  });

  it('writes DeliveryAcknowledged, caused by the ship, on its timeline', async () => {
    const deliveryId = await inFlightWith(scout);

    unwrap(await useCases.acknowledgeDelivery(scout, { deliveryId }));

    const [event] = core.state.events;
    expect(event?.id).toMatch(/^evt_/);
    expect(core.state.events).toEqual([
      {
        id: event?.id,
        fleetId,
        type: 'DeliveryAcknowledged',
        occurredAt: core.clock.now(),
        actor: { kind: 'ship', shipId: scoutId },
        shipId: scoutId,
        messageId: stored(deliveryId)?.messageId,
        deliveryId,
        details: { leaseId: scout.leaseId },
      },
    ]);
  });

  it('acknowledges a type delivery the ship claimed', async () => {
    const deliveryId = await inFlightWith(scout, { kind: 'type', type: 'reviewer' });

    unwrap(await useCases.acknowledgeDelivery(scout, { deliveryId }));

    expect(stored(deliveryId)?.state).toBe('acknowledged');
  });

  it('returns OK when the ship acknowledges it twice, and changes nothing more', async () => {
    const deliveryId = await inFlightWith(scout);
    unwrap(await useCases.acknowledgeDelivery(scout, { deliveryId }));

    await expect(useCases.acknowledgeDelivery(scout, { deliveryId })).resolves.toEqual({ isOk: true, value: undefined });
    expect(stored(deliveryId)?.state).toBe('acknowledged');
    expect(core.state.events.map((event) => event.type)).toEqual(['DeliveryAcknowledged']);
  });

  it('is never returned by a receive once acknowledged', async () => {
    const deliveryId = await inFlightWith(scout);
    unwrap(await useCases.acknowledgeDelivery(scout, { deliveryId }));

    await expect(useCases.receiveDeliveries(scout, {})).resolves.toEqual({ isOk: true, value: { deliveries: [] } });
  });
});

describe('an acknowledgement refused', () => {
  it('for a delivery another ship holds in flight, which stays with that ship', async () => {
    const deliveryId = await inFlightWith(lookout, { kind: 'type', type: 'reviewer' });

    await expect(useCases.acknowledgeDelivery(scout, { deliveryId })).resolves.toEqual({
      isOk: false,
      error: {
        kind: 'DELIVERY_HELD_BY_ANOTHER_SHIP',
        message: `Delivery ${deliveryId} is held by another ship: only the ship that received it acknowledges it`,
      },
    });
    expect(stored(deliveryId)).toMatchObject({ state: 'delivered', claimedByShipId: lookout.shipId });
    expect(core.state.events).toEqual([]);
  });

  it('for a delivery another ship acknowledged', async () => {
    const deliveryId = await inFlightWith(lookout, { kind: 'type', type: 'reviewer' });
    unwrap(await useCases.acknowledgeDelivery(lookout, { deliveryId }));

    await expect(useCases.acknowledgeDelivery(scout, { deliveryId })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'DELIVERY_HELD_BY_ANOTHER_SHIP' },
    });
  });

  it('for a delivery that is not in flight: pending, never received', async () => {
    const deliveryId = await sendTo({ kind: 'ship', shipId: scoutId });
    core.state.events.length = 0;

    await expect(useCases.acknowledgeDelivery(scout, { deliveryId })).resolves.toEqual({
      isOk: false,
      error: {
        kind: 'DELIVERY_NOT_IN_FLIGHT',
        message: `Delivery ${deliveryId} is pending, not in flight: acknowledge a delivery once a receive hands it over`,
      },
    });
    expect(stored(deliveryId)).toMatchObject({ state: 'pending', claimedByShipId: null });
    expect(core.state.events).toEqual([]);
  });

  it('for a delivery that became undeliverable', async () => {
    const deliveryId = await sendTo({ kind: 'ship', shipId: scoutId });
    for (let claim = 1; claim <= 5; claim += 1) {
      await useCases.receiveDeliveries(scout, {});
    }

    await expect(useCases.acknowledgeDelivery(scout, { deliveryId })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'DELIVERY_NOT_IN_FLIGHT' },
    });
    expect(stored(deliveryId)?.state).toBe('undeliverable');
  });

  it('for a delivery the fleet does not hold', async () => {
    const deliveryId = core.ids('delivery');

    await expect(useCases.acknowledgeDelivery(scout, { deliveryId })).resolves.toEqual({
      isOk: false,
      error: { kind: 'DELIVERY_NOT_FOUND', message: `Delivery ${deliveryId} does not exist` },
    });
  });

  it("for another fleet's delivery, as if it did not exist", async () => {
    const deliveryId = await inFlightWith(scout);
    const otherFleetId = core.ids('fleet');
    const stranger = crewAboard(core, { fleetId: otherFleetId, shipId: addAgentShip(core, { fleetId: otherFleetId }).shipId });

    await expect(useCases.acknowledgeDelivery(stranger, { deliveryId })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'DELIVERY_NOT_FOUND' },
    });
    expect(stored(deliveryId)?.state).toBe('delivered');
  });
});
