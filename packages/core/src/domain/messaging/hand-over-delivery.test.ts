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
import { newKey } from '../../../test/support/keys.js';
import { unwrap } from '../../../test/support/result.js';
import { endLease } from '../registry/public.js';
import type { Caller, Crew } from '../shared/caller.js';
import { shipActor } from '../shared/events.js';
import { ok } from '../shared/result.js';
import type { Selector } from '../shared/selector.js';

let core: InMemoryCore;
let useCases: ReturnType<typeof messagingUseCases>;
let fleetId: FleetId;
let argo: Caller;
let scoutId: ShipId;
let scout: Crew;
let lookout: Crew;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-12T12:00:00.000Z');
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
  core.state.events.length = 0;
});

const toScout = (): Selector => ({ kind: 'ship', shipId: scoutId });

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

/** A delivery to the scout, push received by its crew: received, not yet handed. */
async function received(): Promise<DeliveryId> {
  const deliveryId = await sendTo(toScout());
  unwrap(await useCases.pushReceiveDeliveries(scout, {}));
  return deliveryId;
}

function handOver(deliveryId: DeliveryId, handOverNumber: number) {
  return useCases.handOverDelivery(scout, { deliveryId, handOverNumber });
}

function stored(deliveryId: DeliveryId) {
  return core.state.deliveries.find((held) => held.id === deliveryId);
}

function eventsOf(type: string) {
  return core.state.events.filter((event) => event.type === type);
}

describe('handing over a received delivery', () => {
  it('marks it handed with its hand-over number, and counts one attempt', async () => {
    const deliveryId = await received();

    await expect(handOver(deliveryId, 1)).resolves.toEqual(ok({ state: 'handed' }));
    expect(stored(deliveryId)).toMatchObject({
      state: 'handed',
      claimedByShipId: scoutId,
      claimedByLeaseId: scout.leaseId,
      attempts: 1,
      handOverNumber: 1,
    });
  });

  it('writes DeliveryHanded, caused by the ship, with its lease, attempts and hand-over number', async () => {
    const deliveryId = await received();

    unwrap(await handOver(deliveryId, 1));

    const [event] = eventsOf('DeliveryHanded');
    expect(eventsOf('DeliveryHanded')).toEqual([
      {
        id: event?.id,
        fleetId,
        type: 'DeliveryHanded',
        occurredAt: core.clock.now(),
        actor: { kind: 'ship', shipId: scoutId },
        shipId: scoutId,
        messageId: stored(deliveryId)?.messageId,
        deliveryId,
        details: { leaseId: scout.leaseId, attempts: 1, handOverNumber: 1 },
      },
    ]);
  });
});

describe('handed again', () => {
  it('with the same hand-over number is a lost answer: OK, and nothing changes', async () => {
    const deliveryId = await received();
    unwrap(await handOver(deliveryId, 1));
    const before = structuredClone(stored(deliveryId));
    core.state.events.length = 0;

    await expect(handOver(deliveryId, 1)).resolves.toEqual(ok({ state: 'handed' }));
    expect(stored(deliveryId)).toEqual(before);
    expect(core.state.events).toEqual([]);
  });

  it('with a lower hand-over number changes nothing either', async () => {
    const deliveryId = await received();
    unwrap(await handOver(deliveryId, 3));
    const before = structuredClone(stored(deliveryId));

    await expect(handOver(deliveryId, 2)).resolves.toEqual(ok({ state: 'handed' }));
    expect(stored(deliveryId)).toEqual(before);
  });

  it('with a higher hand-over number is a new hand-over: one more attempt, with its number', async () => {
    const deliveryId = await received();
    unwrap(await handOver(deliveryId, 1));

    await expect(handOver(deliveryId, 2)).resolves.toEqual(ok({ state: 'handed' }));
    expect(stored(deliveryId)).toMatchObject({ state: 'handed', attempts: 2, handOverNumber: 2 });
    expect(eventsOf('DeliveryHanded').map((event) => event.details)).toEqual([
      { leaseId: scout.leaseId, attempts: 1, handOverNumber: 1 },
      { leaseId: scout.leaseId, attempts: 2, handOverNumber: 2 },
    ]);
  });

  it('counts a delivery a plain receive handed before the lease was pushed, at any number', async () => {
    const deliveryId = await sendTo(toScout());
    unwrap(await useCases.receiveDeliveries(scout, {}));
    unwrap(await useCases.pushReceiveDeliveries(scout, {}));

    unwrap(await handOver(deliveryId, 1));

    expect(stored(deliveryId)).toMatchObject({ state: 'handed', attempts: 2, handOverNumber: 1 });
  });
});

describe('the fifth attempt', () => {
  it('is still handed at the fourth', async () => {
    const deliveryId = await received();
    for (const number of [1, 2, 3]) {
      unwrap(await handOver(deliveryId, number));
    }

    await expect(handOver(deliveryId, 4)).resolves.toEqual(ok({ state: 'handed' }));
    expect(stored(deliveryId)).toMatchObject({ state: 'handed', attempts: 4 });
  });

  it('is answered undeliverable, hands nothing, and clears the claim', async () => {
    const deliveryId = await received();
    for (const number of [1, 2, 3, 4]) {
      unwrap(await handOver(deliveryId, number));
    }

    await expect(handOver(deliveryId, 5)).resolves.toEqual(ok({ state: 'undeliverable' }));
    expect(stored(deliveryId)).toMatchObject({ state: 'undeliverable', claimedByShipId: null, claimedByLeaseId: null, attempts: 5 });
    expect(eventsOf('DeliveryUndeliverable')).toMatchObject([
      { deliveryId, actor: { kind: 'ship', shipId: scoutId }, details: { leaseId: scout.leaseId, attempts: 5, handOverNumber: 5 } },
    ]);
    expect(eventsOf('DeliveryHanded')).toHaveLength(4);
  });

  it('then refuses any later hand-over: the delivery is not in flight', async () => {
    const deliveryId = await received();
    for (const number of [1, 2, 3, 4, 5]) {
      unwrap(await handOver(deliveryId, number));
    }

    await expect(handOver(deliveryId, 5)).resolves.toMatchObject({ isOk: false, error: { kind: 'DELIVERY_NOT_IN_FLIGHT' } });
  });
});

describe('an acknowledged delivery', () => {
  it('answers acknowledged to its last hand-over number again, and nothing changes', async () => {
    const deliveryId = await received();
    unwrap(await handOver(deliveryId, 1));
    unwrap(await useCases.acknowledgeDelivery(scout, { deliveryId }));
    const before = structuredClone(stored(deliveryId));

    await expect(handOver(deliveryId, 1)).resolves.toEqual(ok({ state: 'acknowledged' }));
    expect(stored(deliveryId)).toEqual(before);
  });

  it('refuses a higher hand-over number: it is no longer in flight', async () => {
    const deliveryId = await received();
    unwrap(await handOver(deliveryId, 1));
    unwrap(await useCases.acknowledgeDelivery(scout, { deliveryId }));

    await expect(handOver(deliveryId, 2)).resolves.toMatchObject({ isOk: false, error: { kind: 'DELIVERY_NOT_IN_FLIGHT' } });
    expect(stored(deliveryId)).toMatchObject({ state: 'acknowledged', attempts: 1 });
  });
});

function handOnceMore(deliveryId: DeliveryId, handOverNumber: number) {
  return useCases.handOverDelivery(scout, { deliveryId, handOverNumber, isOnceMore: true });
}

/** A delivery to the scout, handed as number 1 and acknowledged by the hook. */
async function acknowledged(): Promise<DeliveryId> {
  const deliveryId = await received();
  unwrap(await handOver(deliveryId, 1));
  unwrap(await useCases.acknowledgeDelivery(scout, { deliveryId }));
  return deliveryId;
}

describe('handed once more', () => {
  it('keeps the delivery acknowledged with its new hand-over number, and counts no attempt', async () => {
    const deliveryId = await acknowledged();

    await expect(handOnceMore(deliveryId, 2)).resolves.toEqual(ok({ state: 'acknowledged' }));
    expect(stored(deliveryId)).toMatchObject({
      state: 'acknowledged',
      claimedByLeaseId: scout.leaseId,
      attempts: 1,
      handOverNumber: 2,
      handedOnceMoreAt: core.clock.now(),
    });
  });

  it('writes DeliveryHanded marked once more, with its hand-over number', async () => {
    const deliveryId = await acknowledged();
    core.state.events.length = 0;

    unwrap(await handOnceMore(deliveryId, 2));

    expect(core.state.events).toMatchObject([
      {
        type: 'DeliveryHanded',
        occurredAt: core.clock.now(),
        actor: { kind: 'ship', shipId: scoutId },
        shipId: scoutId,
        deliveryId,
        details: { leaseId: scout.leaseId, attempts: 1, handOverNumber: 2, onceMore: true },
      },
    ]);
  });

  it('takes a delivery the hook acknowledged before any hand-over reached the fleet', async () => {
    const deliveryId = await received();
    unwrap(await useCases.acknowledgeDelivery(scout, { deliveryId }));

    await expect(handOnceMore(deliveryId, 2)).resolves.toEqual(ok({ state: 'acknowledged' }));
    expect(stored(deliveryId)).toMatchObject({ attempts: 0, handOverNumber: 2, handedOnceMoreAt: core.clock.now() });
  });

  it('again with the same hand-over number is a lost answer: OK, and nothing changes', async () => {
    const deliveryId = await acknowledged();
    unwrap(await handOnceMore(deliveryId, 2));
    const before = structuredClone(stored(deliveryId));
    core.state.events.length = 0;
    core.clock.advance(1_000);

    await expect(handOnceMore(deliveryId, 2)).resolves.toEqual(ok({ state: 'acknowledged' }));
    expect(stored(deliveryId)).toEqual(before);
    expect(core.state.events).toEqual([]);
  });

  it('refuses a second once more with a higher number: a message is handed once more only once', async () => {
    const deliveryId = await acknowledged();
    unwrap(await handOnceMore(deliveryId, 2));
    const before = structuredClone(stored(deliveryId));

    await expect(handOnceMore(deliveryId, 3)).resolves.toMatchObject({ isOk: false, error: { kind: 'DELIVERY_HANDED_ONCE_MORE' } });
    expect(stored(deliveryId)).toEqual(before);
  });

  it('refuses a delivery not acknowledged yet: only a confirmed message is handed once more', async () => {
    const deliveryId = await received();
    unwrap(await handOver(deliveryId, 1));

    await expect(handOnceMore(deliveryId, 2)).resolves.toMatchObject({ isOk: false, error: { kind: 'DELIVERY_NOT_ACKNOWLEDGED' } });
    expect(stored(deliveryId)).toMatchObject({ state: 'handed', attempts: 1, handOverNumber: 1, handedOnceMoreAt: null });
  });

  it('refuses a delivery another ship holds', async () => {
    const deliveryId = await acknowledged();

    await expect(useCases.handOverDelivery(lookout, { deliveryId, handOverNumber: 2, isOnceMore: true })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'DELIVERY_HELD_BY_ANOTHER_SHIP' },
    });
  });

  it('refuses a handled delivery: it is not in flight', async () => {
    const deliveryId = await acknowledged();
    unwrap(await useCases.reportHandled(scout, { deliveryId }));

    await expect(handOnceMore(deliveryId, 2)).resolves.toMatchObject({ isOk: false, error: { kind: 'DELIVERY_NOT_IN_FLIGHT' } });
  });

  it('refuses a delivery not handled: it is not in flight', async () => {
    const deliveryId = await acknowledged();
    unwrap(await handOnceMore(deliveryId, 2));
    unwrap(await useCases.reportNotHandled(scout, { deliveryId }));

    await expect(handOnceMore(deliveryId, 2)).resolves.toMatchObject({ isOk: false, error: { kind: 'DELIVERY_NOT_IN_FLIGHT' } });
  });
});

describe('a plain hand-over of a delivery past acknowledged', () => {
  it('refuses a handled one: it is not in flight', async () => {
    const deliveryId = await acknowledged();
    unwrap(await useCases.reportHandled(scout, { deliveryId }));

    await expect(handOver(deliveryId, 1)).resolves.toMatchObject({ isOk: false, error: { kind: 'DELIVERY_NOT_IN_FLIGHT' } });
  });
});

describe('a hand-over that is refused', () => {
  it('refuses a pending delivery: nothing received it', async () => {
    const deliveryId = await sendTo(toScout());

    await expect(handOver(deliveryId, 1)).resolves.toMatchObject({ isOk: false, error: { kind: 'DELIVERY_NOT_IN_FLIGHT' } });
    expect(stored(deliveryId)).toMatchObject({ state: 'pending', attempts: 0 });
  });

  it('refuses a delivery another ship holds', async () => {
    const deliveryId = await received();

    await expect(useCases.handOverDelivery(lookout, { deliveryId, handOverNumber: 1 })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'DELIVERY_HELD_BY_ANOTHER_SHIP' },
    });
    expect(stored(deliveryId)).toMatchObject({ state: 'received', attempts: 0 });
  });

  it('refuses a delivery that does not exist', async () => {
    await expect(handOver(core.ids('delivery'), 1)).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'DELIVERY_NOT_FOUND' },
    });
  });

  it('refuses a crew whose lease has ended', async () => {
    const deliveryId = await received();
    const ended = await core.uow.run(async (tx) =>
      ok(
        await endLease(
          { tx, ids: core.ids },
          { fleetId, leaseId: scout.leaseId, actor: shipActor(argo.shipId), at: core.clock.now(), reason: 'released' },
        ),
      ),
    );
    expect(ended).toEqual(ok(true));

    await expect(handOver(deliveryId, 1)).resolves.toMatchObject({ isOk: false, error: { kind: 'LEASE_ENDED' } });
    expect(stored(deliveryId)).toMatchObject({ state: 'pending', attempts: 0 });
  });
});
