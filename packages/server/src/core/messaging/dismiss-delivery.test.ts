import type { DeliveryId, FleetId, ShipId } from '@aeolus-fleet/common';
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
import type { Selector } from '../shared/selector.js';
import { UNDELIVERABLE_AT_CLAIM } from './delivery.js';

let core: InMemoryCore;
let useCases: ReturnType<typeof messagingUseCases>;
let fleetId: FleetId;
let argo: Caller;
let scoutId: ShipId;
let scout: Crew;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-01T12:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  ({ shipId: scoutId } = unwrap(await registryUseCases(core).commissionShip(argo, { name: 'scout', type: 'reviewer' })));
  scout = crewAboard(core, { fleetId, shipId: scoutId });
  useCases = messagingUseCases(core);
  core.clock.advance(60_000);
});

/** Sends a message from argo and returns its delivery's id, pending. */
async function sendTo(selector: Selector): Promise<DeliveryId> {
  const { messageId } = unwrap(
    await useCases.sendMessage(argo, {
      selector,
      payload: 'Run the e2e suite on pr-320',
      idempotencyKey: `run-${core.ids('message')}`,
    }),
  );
  return deliveryIdOf(core, messageId);
}

/** A delivery the scout's crew received five times without acknowledging it: undeliverable. */
async function undeliverable(selector: Selector = { kind: 'ship', shipId: scoutId }): Promise<DeliveryId> {
  const deliveryId = await sendTo(selector);
  for (let claim = 1; claim <= UNDELIVERABLE_AT_CLAIM; claim += 1) {
    unwrap(await useCases.receiveDeliveries(scout, {}));
  }
  expect(stored(deliveryId)?.state).toBe('undeliverable');
  core.state.events.length = 0;
  return deliveryId;
}

function stored(deliveryId: DeliveryId) {
  return core.state.deliveries.find((held) => held.id === deliveryId);
}

describe('dismissing an undeliverable delivery', () => {
  it('sets it to dismissed, keeping its claims', async () => {
    const deliveryId = await undeliverable();

    await expect(useCases.dismissDelivery(argo, { deliveryId })).resolves.toEqual({ isOk: true, value: undefined });
    expect(stored(deliveryId)).toMatchObject({ state: 'dismissed', attempts: UNDELIVERABLE_AT_CLAIM });
  });

  it('writes DeliveryDismissed, caused by the operator, naming the ship it was for', async () => {
    const deliveryId = await undeliverable();

    unwrap(await useCases.dismissDelivery(argo, { deliveryId }));
    expect(core.state.events).toEqual([
      expect.objectContaining({
        type: 'DeliveryDismissed',
        occurredAt: core.clock.now(),
        actor: { kind: 'ship', shipId: argo.shipId },
        shipId: scoutId,
        messageId: stored(deliveryId)?.messageId,
        deliveryId,
      }),
    ]);
  });

  it('names no ship for a delivery to a type', async () => {
    const deliveryId = await undeliverable({ kind: 'type', type: 'reviewer' });

    unwrap(await useCases.dismissDelivery(argo, { deliveryId }));
    expect(core.state.events).toEqual([expect.objectContaining({ type: 'DeliveryDismissed', shipId: undefined })]);
  });

  it('dismisses a dismissed delivery again as OK, and changes nothing', async () => {
    const deliveryId = await undeliverable();
    unwrap(await useCases.dismissDelivery(argo, { deliveryId }));
    core.state.events.length = 0;

    await expect(useCases.dismissDelivery(argo, { deliveryId })).resolves.toEqual({ isOk: true, value: undefined });
    expect(core.state.events).toEqual([]);
  });

  it.each(['pending', 'delivered', 'acknowledged', 'abandoned'] as const)(
    'refuses a delivery that is %s: only an undeliverable one is dismissed',
    async (state) => {
      const deliveryId = await sendTo({ kind: 'ship', shipId: scoutId });
      const held = stored(deliveryId);
      if (held) {
        held.state = state;
      }

      await expect(useCases.dismissDelivery(argo, { deliveryId })).resolves.toMatchObject({
        isOk: false,
        error: { kind: 'DELIVERY_NOT_UNDELIVERABLE' },
      });
      expect(stored(deliveryId)?.state).toBe(state);
      expect(core.state.events.filter((event) => event.type === 'DeliveryDismissed')).toEqual([]);
    },
  );

  it('refuses a delivery the fleet does not have', async () => {
    await expect(useCases.dismissDelivery(argo, { deliveryId: core.ids('delivery') })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'DELIVERY_NOT_FOUND' },
    });
  });
});
