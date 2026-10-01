import type { DeliveryId, FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  crewAboard,
  deliveryIdOf,
  initialiseFleet,
  messagingUseCases,
  operatorCaller,
  registryUseCases,
  secretIn,
} from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import type { Caller, Crew } from '../shared/caller.js';
import type { Selector } from '../shared/selector.js';

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let messaging: ReturnType<typeof messagingUseCases>;
let fleetId: FleetId;
let argo: Caller;
let scoutId: ShipId;
let scoutSecret: string;
let lookout: Crew;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-01T14:00:00.000Z');
  const fleet = await initialiseFleet(core);
  fleetId = fleet.fleetId;
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  messaging = messagingUseCases(core);
  const scout = unwrap(await registry.commissionShip(argo, { name: 'scout', type: 'reviewer' }));
  scoutId = scout.shipId;
  scoutSecret = secretIn(scout.prompt);
  const { shipId: lookoutId } = unwrap(await registry.commissionShip(argo, { name: 'lookout', type: 'reviewer' }));
  lookout = crewAboard(core, { fleetId, shipId: lookoutId });
  core.clock.advance(60_000);
});

const toScout = (): Selector => ({ kind: 'ship', shipId: scoutId });
const toReviewers: Selector = { kind: 'type', type: 'reviewer' };

async function sendTo(selector: Selector): Promise<DeliveryId> {
  const { messageId } = unwrap(
    await messaging.sendMessage(argo, { selector, payload: 'Review PR 48', idempotencyKey: `key-${core.ids('message')}` }),
  );
  return deliveryIdOf(core, messageId);
}

function delivery(deliveryId: DeliveryId) {
  return core.state.deliveries.find((held) => held.id === deliveryId);
}

function eventsOfType(type: string) {
  return core.state.events.filter((event) => event.type === type);
}

async function retireScout() {
  return registry.retireShip(argo, { shipId: scoutId });
}

describe('retiring a ship', () => {
  it('retires a ship awaiting crew for good: retired in the fleet, its secret stops working, ShipRetired by the caller', async () => {
    unwrap(await retireScout());

    expect((await registry.listFleet(argo)).find((ship) => ship.id === scoutId)).toMatchObject({ status: 'retired' });
    await expect(
      registry.claimShip({ shipId: scoutId, secret: scoutSecret, location: { kind: 'DEVICE' } }),
    ).resolves.toMatchObject({ isOk: false });
    expect(eventsOfType('ShipRetired')).toMatchObject([
      { shipId: scoutId, actor: { kind: 'ship', shipId: argo.shipId }, details: { abandonedDeliveries: 0 } },
    ]);
  });

  it("ends a crewed ship's lease first: its crew token stops working", async () => {
    const scout = crewAboard(core, { fleetId, shipId: scoutId });

    unwrap(await retireScout());

    await expect(messaging.receiveDeliveries(scout, {})).resolves.toMatchObject({ isOk: false, error: { kind: 'LEASE_ENDED' } });
    expect(eventsOfType('LeaseRevoked')).toMatchObject([{ shipId: scoutId, details: { reason: 'retired' } }]);
  });

  it('abandons its direct deliveries, pending and in flight, one DeliveryAbandoned each, and ShipRetired counts them', async () => {
    const scout = crewAboard(core, { fleetId, shipId: scoutId });
    const inFlight = await sendTo(toScout());
    unwrap(await messaging.receiveDeliveries(scout, {}));
    const pending = await sendTo(toScout());

    unwrap(await retireScout());

    expect(delivery(inFlight)).toMatchObject({ state: 'abandoned', claimedByShipId: null });
    expect(delivery(pending)).toMatchObject({ state: 'abandoned' });
    expect(eventsOfType('DeliveryAbandoned').map((event) => event.deliveryId).sort()).toEqual([inFlight, pending].sort());
    expect(eventsOfType('ShipRetired')).toMatchObject([{ details: { abandonedDeliveries: 2 } }]);
  });

  it('never abandons a delivery to its type: one it held goes back to the queue for the other ships of the type', async () => {
    const scout = crewAboard(core, { fleetId, shipId: scoutId });
    const queued = await sendTo(toReviewers);
    unwrap(await messaging.receiveDeliveries(scout, {}));

    unwrap(await retireScout());

    expect(delivery(queued)).toMatchObject({ state: 'pending', claimedByShipId: null });
    expect(unwrap(await messaging.receiveDeliveries(lookout, {})).deliveries).toMatchObject([{ deliveryId: queued }]);
  });

  it('leaves an undeliverable direct delivery undeliverable, for Needs attention', async () => {
    const undeliverable = await sendTo(toScout());
    const held = delivery(undeliverable);
    if (held) {
      held.state = 'undeliverable';
    }

    unwrap(await retireScout());

    expect(delivery(undeliverable)).toMatchObject({ state: 'undeliverable' });
    expect(eventsOfType('DeliveryAbandoned')).toEqual([]);
  });

  it('is never addressed again: a send to it is refused', async () => {
    unwrap(await retireScout());

    await expect(
      messaging.sendMessage(argo, { selector: toScout(), payload: 'Still there?', idempotencyKey: 'after-retire' }),
    ).resolves.toMatchObject({ isOk: false, error: { kind: 'UNRESOLVABLE_SELECTOR' } });
  });

  it('frees its name for a new ship', async () => {
    unwrap(await retireScout());

    await expect(registry.commissionShip(argo, { name: 'scout', type: 'reviewer' })).resolves.toMatchObject({ isOk: true });
  });

  it('refuses argo, which is permanent', async () => {
    await expect(registry.retireShip(argo, { shipId: argo.shipId })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'OPERATOR_SHIP_IS_PERMANENT' },
    });
  });

  it('refuses a ship retired already', async () => {
    unwrap(await retireScout());

    await expect(retireScout()).resolves.toMatchObject({ isOk: false, error: { kind: 'SHIP_ALREADY_RETIRED' } });
  });

  it('knows no ship of another fleet', async () => {
    await expect(registry.retireShip({ ...argo, fleetId: core.ids('fleet') }, { shipId: scoutId })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'SHIP_NOT_FOUND' },
    });
  });

  it('leaves everything as it was when it refuses', async () => {
    const before = structuredClone(core.state);

    await registry.retireShip(argo, { shipId: argo.shipId });

    expect(core.state).toEqual(before);
  });
});
