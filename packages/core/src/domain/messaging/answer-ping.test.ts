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
import { newKey } from '../../../test/support/keys.js';

let core: InMemoryCore;
let useCases: ReturnType<typeof messagingUseCases>;
let fleetId: FleetId;
let argo: Caller;
let scoutId: ShipId;
let scout: Crew;
let lookout: Crew;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-02T09:00:00.000Z');
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

/** Pings the ship and has its crew receive the ping; answers the ping's delivery id. */
async function pingReceivedBy(crew: Crew): Promise<DeliveryId> {
  const { messageId } = unwrap(await useCases.pingShip(argo, { shipId: crew.shipId }));
  unwrap(await useCases.receiveDeliveries(crew, {}));
  core.state.events.length = 0;
  core.clock.advance(4_000);
  return deliveryIdOf(core, messageId);
}

function stored(deliveryId: DeliveryId) {
  return core.state.deliveries.find((held) => held.id === deliveryId);
}

function lastSeenOf(crew: Crew): Date | undefined {
  return core.state.leaseSeen.find((seen) => seen.leaseId === crew.leaseId)?.at;
}

describe('answering a ping with pong', () => {
  it('acknowledges the ping delivery the ship holds in flight', async () => {
    const deliveryId = await pingReceivedBy(scout);

    await expect(useCases.answerPing(scout, { deliveryId })).resolves.toEqual({ isOk: true, value: undefined });
    expect(stored(deliveryId)).toMatchObject({ state: 'acknowledged', claimedByShipId: scoutId, claimedByLeaseId: scout.leaseId });
  });

  it('writes DeliveryAcknowledged, caused by the ship, saying pong answered it', async () => {
    const deliveryId = await pingReceivedBy(scout);

    unwrap(await useCases.answerPing(scout, { deliveryId }));

    expect(core.state.events).toEqual([
      expect.objectContaining({
        type: 'DeliveryAcknowledged',
        occurredAt: core.clock.now(),
        actor: { kind: 'ship', shipId: scoutId },
        shipId: scoutId,
        deliveryId,
        details: { leaseId: scout.leaseId, answer: 'pong' },
      }),
    ]);
  });

  it("sets the lease's last seen to that moment", async () => {
    const deliveryId = await pingReceivedBy(scout);

    unwrap(await useCases.answerPing(scout, { deliveryId }));

    expect(lastSeenOf(scout)).toEqual(core.clock.now());
  });

  it('is OK again and changes nothing, keeping the first answer', async () => {
    const deliveryId = await pingReceivedBy(scout);
    unwrap(await useCases.answerPing(scout, { deliveryId }));
    core.clock.advance(30_000);
    const before = structuredClone(core.state);

    await expect(useCases.answerPing(scout, { deliveryId })).resolves.toEqual({ isOk: true, value: undefined });
    expect(core.state).toEqual(before);
  });

  it('is OK after a plain ack and changes nothing: the ping stays received, not answered with pong', async () => {
    const deliveryId = await pingReceivedBy(scout);
    unwrap(await useCases.acknowledgeDelivery(scout, { deliveryId }));
    const before = structuredClone(core.state);

    await expect(useCases.answerPing(scout, { deliveryId })).resolves.toEqual({ isOk: true, value: undefined });
    expect(core.state).toEqual(before);
  });
});

describe('a pong refused', () => {
  async function expectRefused(pong: { crew: Crew; deliveryId: DeliveryId }, kind: string): Promise<void> {
    const { crew, deliveryId } = pong;
    const before = structuredClone(core.state);

    await expect(useCases.answerPing(crew, { deliveryId })).resolves.toMatchObject({ isOk: false, error: { kind } });

    expect(core.state).toEqual(before);
  }

  it('refuses a delivery that is not a ping: pong answers only a ping', async () => {
    const { messageId } = unwrap(
      await useCases.sendMessage(argo, {
        selector: { kind: 'ship', shipId: scoutId },
        payload: 'Review PR 76',
        idempotencyKey: 'review-76',
      }),
    );
    unwrap(await useCases.receiveDeliveries(scout, {}));

    await expectRefused({ crew: scout, deliveryId: deliveryIdOf(core, messageId) }, 'DELIVERY_NOT_A_PING');
  });

  it("refuses another ship's ping: only the ship holding it answers it", async () => {
    const deliveryId = await pingReceivedBy(scout);

    await expectRefused({ crew: lookout, deliveryId }, 'DELIVERY_HELD_BY_ANOTHER_SHIP');
  });

  it('refuses a ping no receive handed over yet', async () => {
    const { messageId } = unwrap(await useCases.pingShip(argo, { shipId: scoutId }));

    await expectRefused({ crew: scout, deliveryId: deliveryIdOf(core, messageId) }, 'DELIVERY_NOT_IN_FLIGHT');
  });

  it('refuses a delivery the fleet does not have', async () => {
    await expectRefused({ crew: scout, deliveryId: core.ids('delivery') }, 'DELIVERY_NOT_FOUND');
  });
});
