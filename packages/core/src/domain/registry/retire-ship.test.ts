import type { DeliveryId, FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  crewAboard,
  deliveryIdOf,
  initialiseFleet,
  messagingUseCases,
  operatorCaller,
  registryUseCases,
  secretOf,
} from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import type { Caller, Crew } from '../shared/caller.js';
import type { Selector } from '../shared/selector.js';
import { newKey } from '../../../test/support/keys.js';

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
  const scout = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
  scoutId = scout.shipId;
  scoutSecret = secretOf(scout.secret);
  const { shipId: lookoutId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'lookout', type: 'reviewer' }));
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
      registry.claimShip({ shipId: scoutId, secret: scoutSecret, location: { kind: 'DEVICE' }, harness: 'claude-code' }),
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

    await expect(registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })).resolves.toMatchObject({ isOk: true });
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

describe('the labels of a retired ship', () => {
  let plugin: Caller;
  let pluginId: ShipId;
  let builderId: ShipId;

  beforeEach(async () => {
    plugin = await shipWithScopes({ registry, argo }, { name: 'trierarch-plugin', type: 'trierarch-plugin', scopes: ['fleet:read', 'labels:define', 'labels:assign'] });
    pluginId = plugin.shipId;
    ({ shipId: builderId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'builder', type: 'implementer' })));
    unwrap(await registry.defineLabel(plugin, { key: 'os', values: ['macos', 'linux'] }));
    unwrap(await registry.defineLabel(plugin, { key: 'project', values: ['hemma'] }));
    unwrap(await registry.assignLabel(plugin, { shipId: builderId, key: 'os', value: 'macos' }));
    unwrap(await registry.assignLabel(plugin, { shipId: scoutId, key: 'os', value: 'linux' }));
    unwrap(await registry.assignLabel(plugin, { shipId: scoutId, key: 'project', value: 'hemma' }));
    core.clock.advance(60_000);
    core.state.events.length = 0;
  });

  function carried() {
    return core.state.shipLabels.map(({ shipId, key, value }) => ({ shipId, label: `${key}=${value}` }));
  }

  it('go with it: the ship carries none, with one LabelUnassigned each, caused by the retirer', async () => {
    unwrap(await registry.retireShip(argo, { shipId: scoutId }));

    expect(carried()).toEqual([{ shipId: builderId, label: 'os=macos' }]);
    expect(eventsOfType('LabelUnassigned')).toEqual([
      expect.objectContaining({ actor: { kind: 'ship', shipId: argo.shipId }, shipId: scoutId, occurredAt: core.clock.now(), details: { key: 'os', value: 'linux' } }),
      expect.objectContaining({ actor: { kind: 'ship', shipId: argo.shipId }, shipId: scoutId, occurredAt: core.clock.now(), details: { key: 'project', value: 'hemma' } }),
    ]);
  });

  it('it owns retire with it: their definitions and every assignment of them go, with LabelUnassigned and LabelRetired', async () => {
    unwrap(await registry.retireShip(argo, { shipId: pluginId }));

    expect(core.state.labels).toEqual([]);
    expect(carried()).toEqual([]);
    expect(core.state.events.filter((event) => event.type.startsWith('Label')).map((event) => [event.type, event.shipId, event.details])).toEqual([
      ['LabelUnassigned', scoutId, { key: 'os', value: 'linux' }],
      ['LabelUnassigned', builderId, { key: 'os', value: 'macos' }],
      ['LabelRetired', pluginId, { key: 'os' }],
      ['LabelUnassigned', scoutId, { key: 'project', value: 'hemma' }],
      ['LabelRetired', pluginId, { key: 'project' }],
    ]);
  });

  it('it owned can be defined again once it retired, by another ship', async () => {
    unwrap(await registry.retireShip(argo, { shipId: pluginId }));

    await expect(registry.defineLabel(argo, { key: 'os', values: ['windows'] })).resolves.toEqual({ isOk: true, value: undefined });
  });

  it('it owns stay while it is only released: its meaning retires with its owner, not its crew', async () => {
    const crew = crewAboard(core, { fleetId, shipId: pluginId });
    unwrap(await registry.releaseShip(argo, { shipId: crew.shipId }));

    expect(core.state.labels.map((label) => label.key)).toEqual(['os', 'project']);
    expect(carried()).toHaveLength(3);
    expect(core.state.events.filter((event) => event.type.startsWith('Label'))).toEqual([]);
  });
});
