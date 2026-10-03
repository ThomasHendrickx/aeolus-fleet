import type { DeliveryId, FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  argoAboard,
  crewAboard,
  deliveryIdOf,
  identityUseCases,
  initialiseFleet,
  messagingUseCases,
  operatorCaller,
  registryUseCases,
} from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import type { Crew } from '../shared/caller.js';
import { newKey } from '../../../test/support/keys.js';

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
    await registryUseCases(core).commissionShip(operatorCaller(fleet), { idempotencyKey: newKey(), name: 'release-captain', type: 'release' }),
  );
  captain = crewAboard(core, { fleetId, shipId });
  argo = await argoAboard(core);
  useCases = messagingUseCases(core);
  core.clock.advance(60_000);
});

/** A message from release-captain to argo, waiting in argo's inbox. */
async function toArgo(): Promise<DeliveryId> {
  const { messageId } = unwrap(
    await useCases.sendMessage(captain, {
      selector: { kind: 'ship', shipId: argoId },
      payload: 'Release 2.14 is staged on hetzner-2. Promote to production?',
      idempotencyKey: `promote-${core.ids('message')}`,
    }),
  );
  core.state.events.length = 0;
  core.clock.advance(60_000);
  return deliveryIdOf(core, messageId);
}

function stored(deliveryId: DeliveryId) {
  return core.state.deliveries.find((held) => held.id === deliveryId);
}

describe('marking a message to argo done', () => {
  it("acknowledges it, claimed by argo under the console session's lease, as one claim", async () => {
    const deliveryId = await toArgo();

    await expect(useCases.markDone(argo, { deliveryId })).resolves.toEqual({ isOk: true, value: undefined });
    expect(stored(deliveryId)).toMatchObject({
      state: 'acknowledged',
      claimedByShipId: argoId,
      claimedByLeaseId: argo.leaseId,
      attempts: 1,
    });
  });

  it('writes DeliveryClaimed and DeliveryAcknowledged, caused by argo', async () => {
    const deliveryId = await toArgo();

    unwrap(await useCases.markDone(argo, { deliveryId }));
    const byArgo = { kind: 'ship', shipId: argoId };
    expect(core.state.events).toEqual([
      expect.objectContaining({
        type: 'DeliveryClaimed',
        occurredAt: core.clock.now(),
        actor: byArgo,
        shipId: argoId,
        deliveryId,
        details: { leaseId: argo.leaseId, attempts: 1 },
      }),
      expect.objectContaining({ type: 'DeliveryAcknowledged', actor: byArgo, shipId: argoId, deliveryId }),
    ]);
  });

  it('marks a done message done again as OK, and changes nothing', async () => {
    const deliveryId = await toArgo();
    unwrap(await useCases.markDone(argo, { deliveryId }));
    core.state.events.length = 0;

    await expect(useCases.markDone(argo, { deliveryId })).resolves.toEqual({ isOk: true, value: undefined });
    expect(core.state.events).toEqual([]);
  });

  it.each(['undeliverable', 'dismissed', 'abandoned'] as const)('refuses a delivery that is %s', async (state) => {
    const deliveryId = await toArgo();
    const held = stored(deliveryId);
    if (held) {
      held.state = state;
    }

    await expect(useCases.markDone(argo, { deliveryId })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'DELIVERY_NOT_OPEN' },
    });
    expect(core.state.events).toEqual([]);
  });

  it("refuses a delivery to another ship: it is not in argo's inbox", async () => {
    const { messageId } = unwrap(
      await useCases.sendMessage(argo, {
        selector: { kind: 'ship', shipId: captain.shipId },
        payload: 'go',
        idempotencyKey: 'go',
      }),
    );

    await expect(useCases.markDone(argo, { deliveryId: deliveryIdOf(core, messageId) })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'DELIVERY_NOT_FOUND' },
    });
  });

  it('refuses a delivery the fleet does not have', async () => {
    await expect(useCases.markDone(argo, { deliveryId: core.ids('delivery') })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'DELIVERY_NOT_FOUND' },
    });
  });

  it('refuses any ship but argo: an agent acknowledges what it receives', async () => {
    const deliveryId = await toArgo();

    await expect(useCases.markDone(captain, { deliveryId })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'NOT_THE_OPERATOR_SHIP' },
    });
    expect(stored(deliveryId)?.state).toBe('pending');
  });

  it('refuses once the console session ended, and leaves the message open', async () => {
    const deliveryId = await toArgo();
    await identityUseCases(core).signOut(argo);

    await expect(useCases.markDone(argo, { deliveryId })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'LEASE_ENDED' },
    });
    expect(stored(deliveryId)?.state).toBe('pending');
  });
});
