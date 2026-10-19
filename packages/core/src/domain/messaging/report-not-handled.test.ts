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
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';
import { endLease } from '../registry/public.js';
import type { ShipCaller, Crew } from '../shared/caller.js';
import { shipActor } from '../shared/events.js';
import { ok } from '../shared/result.js';
import type { Selector } from '../shared/selector.js';

let core: InMemoryCore;
let useCases: ReturnType<typeof messagingUseCases>;
let fleetId: FleetId;
let argo: ShipCaller;
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

/** A delivery to the scout, handed as number 1 and acknowledged by the hook. */
async function acknowledged(): Promise<DeliveryId> {
  const deliveryId = await received();
  unwrap(await handOver(deliveryId, 1));
  unwrap(await useCases.acknowledgeDelivery(scout, { deliveryId }));
  return deliveryId;
}

/** A delivery to the scout, acknowledged, whose turn died: handed once more as number 2. */
async function handedOnceMore(): Promise<DeliveryId> {
  const deliveryId = await acknowledged();
  unwrap(await useCases.handOverDelivery(scout, { deliveryId, handOverNumber: 2, isOnceMore: true }));
  return deliveryId;
}

async function releaseScout(): Promise<void> {
  const ended = await core.uow.run(async (tx) =>
    ok(
      await endLease(
        { tx, ids: core.ids },
        { fleetId, leaseId: scout.leaseId, actor: shipActor(argo.shipId), at: core.clock.now(), reason: 'released' },
      ),
    ),
  );
  expect(ended).toEqual(ok(true));
}

function stored(deliveryId: DeliveryId) {
  return core.state.deliveries.find((held) => held.id === deliveryId);
}

function eventsOf(type: string) {
  return core.state.events.filter((event) => event.type === type);
}

/** Why a crew stops a delivery it handed and that was not confirmed: the outside call may have run. */
const UNSAFE = 'the call may have run; its answer was lost';

const reportNotHandled = (deliveryId: DeliveryId) => useCases.reportNotHandled(scout, { deliveryId });

describe('not handled', () => {
  it('moves a delivery handed once more to not handled, keeping who it was handed to', async () => {
    const deliveryId = await handedOnceMore();

    await expect(reportNotHandled(deliveryId)).resolves.toEqual(ok(undefined));
    expect(stored(deliveryId)).toMatchObject({ state: 'notHandled', claimedByShipId: scoutId, claimedByLeaseId: scout.leaseId, attempts: 1 });
  });

  it('writes DeliveryNotHandled, caused by the ship, with its lease', async () => {
    const deliveryId = await handedOnceMore();
    core.state.events.length = 0;

    unwrap(await reportNotHandled(deliveryId));

    const [event] = eventsOf('DeliveryNotHandled');
    expect(core.state.events).toEqual([
      {
        id: event?.id,
        fleetId,
        type: 'DeliveryNotHandled',
        occurredAt: core.clock.now(),
        actor: { kind: 'ship', shipId: scoutId },
        shipId: scoutId,
        messageId: stored(deliveryId)?.messageId,
        deliveryId,
        details: { leaseId: scout.leaseId },
      },
    ]);
  });

  it('keeps the reason the crew gave with DeliveryNotHandled (#847)', async () => {
    const deliveryId = await handedOnceMore();
    core.state.events.length = 0;

    unwrap(await useCases.reportNotHandled(scout, { deliveryId, reason: 'the turn it was handed once more to died too' }));

    expect(eventsOf('DeliveryNotHandled').map((event) => event.details)).toEqual([
      { leaseId: scout.leaseId, reason: 'the turn it was handed once more to died too' },
    ]);
  });

  it('again is harmless: OK, and nothing changes', async () => {
    const deliveryId = await handedOnceMore();
    unwrap(await reportNotHandled(deliveryId));
    const before = structuredClone(stored(deliveryId));
    core.state.events.length = 0;

    await expect(reportNotHandled(deliveryId)).resolves.toEqual(ok(undefined));
    expect(stored(deliveryId)).toEqual(before);
    expect(core.state.events).toEqual([]);
  });
});

describe('not handled, for a delivery handed and not confirmed (interop 5.2)', () => {
  it('moves it to not handled when its crew gives the reason it judged it unsafe to hand again, counting no attempt', async () => {
    const deliveryId = await received();
    unwrap(await handOver(deliveryId, 1));

    await expect(useCases.reportNotHandled(scout, { deliveryId, reason: UNSAFE })).resolves.toEqual(ok(undefined));
    expect(stored(deliveryId)).toMatchObject({ state: 'notHandled', claimedByShipId: scoutId, claimedByLeaseId: scout.leaseId, attempts: 1 });
  });

  it('writes DeliveryNotHandled with that reason', async () => {
    const deliveryId = await received();
    unwrap(await handOver(deliveryId, 1));
    core.state.events.length = 0;

    unwrap(await useCases.reportNotHandled(scout, { deliveryId, reason: UNSAFE }));

    expect(eventsOf('DeliveryNotHandled').map((event) => event.details)).toEqual([{ leaseId: scout.leaseId, reason: UNSAFE }]);
  });

  it('takes one handed by a plain receive as well', async () => {
    const deliveryId = await sendTo(toScout());
    unwrap(await useCases.receiveDeliveries(scout, {}));

    unwrap(await useCases.reportNotHandled(scout, { deliveryId, reason: UNSAFE }));

    expect(stored(deliveryId)).toMatchObject({ state: 'notHandled' });
  });
});

describe('not handled, refused', () => {
  it('refuses an acknowledged delivery never handed once more: not handled means its turn died twice', async () => {
    const deliveryId = await acknowledged();

    await expect(reportNotHandled(deliveryId)).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'DELIVERY_NOT_HANDED_ONCE_MORE' },
    });
    expect(stored(deliveryId)).toMatchObject({ state: 'acknowledged' });
  });

  it('refuses a handled delivery: its turn ended by itself', async () => {
    const deliveryId = await handedOnceMore();
    unwrap(await useCases.reportHandled(scout, { deliveryId }));

    await expect(reportNotHandled(deliveryId)).resolves.toMatchObject({ isOk: false, error: { kind: 'DELIVERY_NOT_ACKNOWLEDGED' } });
    expect(stored(deliveryId)).toMatchObject({ state: 'handled' });
  });

  it('refuses a handed delivery not acknowledged without a reason: only a crew that judged it unsafe to hand again stops it there', async () => {
    const deliveryId = await received();
    unwrap(await handOver(deliveryId, 1));

    await expect(reportNotHandled(deliveryId)).resolves.toMatchObject({ isOk: false, error: { kind: 'DELIVERY_NOT_ACKNOWLEDGED' } });
    expect(stored(deliveryId)).toMatchObject({ state: 'handed' });
  });

  it('refuses a received delivery never handed, even with a reason: handing it is safe', async () => {
    const deliveryId = await received();

    await expect(useCases.reportNotHandled(scout, { deliveryId, reason: UNSAFE })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'DELIVERY_NOT_ACKNOWLEDGED' },
    });
    expect(stored(deliveryId)).toMatchObject({ state: 'received' });
  });

  it('refuses a pending delivery: it is not in flight', async () => {
    const deliveryId = await sendTo(toScout());

    await expect(reportNotHandled(deliveryId)).resolves.toMatchObject({ isOk: false, error: { kind: 'DELIVERY_NOT_IN_FLIGHT' } });
  });

  it('refuses a delivery another ship holds', async () => {
    const deliveryId = await handedOnceMore();

    await expect(useCases.reportNotHandled(lookout, { deliveryId })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'DELIVERY_HELD_BY_ANOTHER_SHIP' },
    });
  });

  it('refuses a delivery that does not exist', async () => {
    await expect(reportNotHandled(core.ids('delivery'))).resolves.toMatchObject({ isOk: false, error: { kind: 'DELIVERY_NOT_FOUND' } });
  });

  it('refuses a crew whose lease ended: the delivery ends acknowledged, handled unknown', async () => {
    const deliveryId = await handedOnceMore();
    await releaseScout();

    await expect(reportNotHandled(deliveryId)).resolves.toMatchObject({ isOk: false, error: { kind: 'LEASE_ENDED' } });
    expect(stored(deliveryId)).toMatchObject({ state: 'acknowledged' });
  });
});
