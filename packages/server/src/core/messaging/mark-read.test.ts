import type { DeliveryId, FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  argoAboard,
  crewAboard,
  deliveryIdOf,
  initialiseFleet,
  messagingUseCases,
  operatorCaller,
  registryUseCases,
} from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import type { Crew } from '../shared/caller.js';

let core: InMemoryCore;
let useCases: ReturnType<typeof messagingUseCases>;
let fleetId: FleetId;
let argoId: ShipId;
let argo: Crew;
let captain: Crew;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-01T14:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId, operatorShipId: argoId } = fleet);
  const { shipId } = unwrap(
    await registryUseCases(core).commissionShip(operatorCaller(fleet), { name: 'release-captain', type: 'release' }),
  );
  captain = crewAboard(core, { fleetId, shipId });
  argo = await argoAboard(core);
  useCases = messagingUseCases(core);
  core.clock.advance(60_000);
});

async function toArgo(): Promise<DeliveryId> {
  const { messageId } = unwrap(
    await useCases.sendMessage(captain, {
      selector: { kind: 'ship', shipId: argoId },
      payload: 'checkout-e2e failed 3 of 5 runs since 12:00.',
      idempotencyKey: `failed-${core.ids('message')}`,
    }),
  );
  core.state.events.length = 0;
  core.clock.advance(60_000);
  return deliveryIdOf(core, messageId);
}

function readAt(deliveryId: DeliveryId) {
  return core.state.deliveryReads.find((read) => read.deliveryId === deliveryId)?.readAt ?? null;
}

describe('marking a message to argo read', () => {
  it('records when it was read, and leaves it open: read is not done', async () => {
    const deliveryId = await toArgo();

    await expect(useCases.markRead(argo, { deliveryId, isRead: true })).resolves.toEqual({ isOk: true, value: undefined });
    expect(readAt(deliveryId)).toEqual(core.clock.now());
    expect(core.state.deliveries.find((held) => held.id === deliveryId)?.state).toBe('pending');
  });

  it('writes no event: read is how the operator sees it, not a delivery state', async () => {
    const deliveryId = await toArgo();

    unwrap(await useCases.markRead(argo, { deliveryId, isRead: true }));
    expect(core.state.events).toEqual([]);
  });

  it('keeps when it was first read when it is opened again', async () => {
    const deliveryId = await toArgo();
    unwrap(await useCases.markRead(argo, { deliveryId, isRead: true }));
    const first = core.clock.now();
    core.clock.advance(60_000);

    unwrap(await useCases.markRead(argo, { deliveryId, isRead: true }));
    expect(readAt(deliveryId)).toEqual(first);
  });

  it('marks it unread again', async () => {
    const deliveryId = await toArgo();
    unwrap(await useCases.markRead(argo, { deliveryId, isRead: true }));

    unwrap(await useCases.markRead(argo, { deliveryId, isRead: false }));
    expect(readAt(deliveryId)).toBeNull();
  });

  it('marks a done message read or unread too', async () => {
    const deliveryId = await toArgo();
    unwrap(await useCases.markDone(argo, { deliveryId }));

    unwrap(await useCases.markRead(argo, { deliveryId, isRead: true }));
    expect(readAt(deliveryId)).toEqual(core.clock.now());
  });

  it("refuses a delivery that is not in argo's inbox", async () => {
    const { messageId } = unwrap(
      await useCases.sendMessage(argo, { selector: { kind: 'ship', shipId: captain.shipId }, payload: 'hi', idempotencyKey: 'hi' }),
    );

    await expect(useCases.markRead(argo, { deliveryId: deliveryIdOf(core, messageId), isRead: true })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'DELIVERY_NOT_FOUND' },
    });
  });

  it('refuses any ship but argo', async () => {
    const deliveryId = await toArgo();

    await expect(useCases.markRead(captain, { deliveryId, isRead: true })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'NOT_THE_OPERATOR_SHIP' },
    });
    expect(readAt(deliveryId)).toBeNull();
  });
});
