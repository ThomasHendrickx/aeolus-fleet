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

const reportHandled = (deliveryId: DeliveryId) => useCases.reportHandled(scout, { deliveryId });

describe('handled', () => {
  it('moves an acknowledged delivery to handled, keeping who it was handed to', async () => {
    const deliveryId = await acknowledged();

    await expect(reportHandled(deliveryId)).resolves.toEqual(ok(undefined));
    expect(stored(deliveryId)).toMatchObject({ state: 'handled', claimedByShipId: scoutId, claimedByLeaseId: scout.leaseId, attempts: 1 });
  });

  it('writes DeliveryHandled, caused by the ship, with its lease', async () => {
    const deliveryId = await acknowledged();
    core.state.events.length = 0;

    unwrap(await reportHandled(deliveryId));

    const [event] = eventsOf('DeliveryHandled');
    expect(core.state.events).toEqual([
      {
        id: event?.id,
        fleetId,
        type: 'DeliveryHandled',
        occurredAt: core.clock.now(),
        actor: { kind: 'ship', shipId: scoutId },
        shipId: scoutId,
        messageId: stored(deliveryId)?.messageId,
        deliveryId,
        details: { leaseId: scout.leaseId },
      },
    ]);
  });

  it('takes a delivery handed once more: the turn that took it again ended by itself', async () => {
    const deliveryId = await handedOnceMore();

    await expect(reportHandled(deliveryId)).resolves.toEqual(ok(undefined));
    expect(stored(deliveryId)).toMatchObject({ state: 'handled' });
  });

  it('takes a ping answered with pong', async () => {
    const { messageId } = unwrap(await useCases.pingShip(argo, { shipId: scoutId }));
    const deliveryId = deliveryIdOf(core, messageId);
    unwrap(await useCases.pushReceiveDeliveries(scout, {}));
    unwrap(await handOver(deliveryId, 1));
    unwrap(await useCases.answerPing(scout, { deliveryId }));

    await expect(reportHandled(deliveryId)).resolves.toEqual(ok(undefined));
    expect(stored(deliveryId)).toMatchObject({ state: 'handled' });
  });

  it('again is harmless: OK, and nothing changes', async () => {
    const deliveryId = await acknowledged();
    unwrap(await reportHandled(deliveryId));
    const before = structuredClone(stored(deliveryId));
    core.state.events.length = 0;

    await expect(reportHandled(deliveryId)).resolves.toEqual(ok(undefined));
    expect(stored(deliveryId)).toEqual(before);
    expect(core.state.events).toEqual([]);
  });
});

describe('handled, refused', () => {
  it('refuses a handed delivery not acknowledged: a ping not answered with pong stays handed', async () => {
    const { messageId } = unwrap(await useCases.pingShip(argo, { shipId: scoutId }));
    const deliveryId = deliveryIdOf(core, messageId);
    unwrap(await useCases.pushReceiveDeliveries(scout, {}));
    unwrap(await handOver(deliveryId, 1));

    await expect(reportHandled(deliveryId)).resolves.toMatchObject({ isOk: false, error: { kind: 'DELIVERY_NOT_ACKNOWLEDGED' } });
    expect(stored(deliveryId)).toMatchObject({ state: 'handed' });
  });

  it('refuses a received delivery not acknowledged', async () => {
    const deliveryId = await received();

    await expect(reportHandled(deliveryId)).resolves.toMatchObject({ isOk: false, error: { kind: 'DELIVERY_NOT_ACKNOWLEDGED' } });
    expect(stored(deliveryId)).toMatchObject({ state: 'received' });
  });

  it('refuses a delivery not handled: it never was', async () => {
    const deliveryId = await handedOnceMore();
    unwrap(await useCases.reportNotHandled(scout, { deliveryId }));

    await expect(reportHandled(deliveryId)).resolves.toMatchObject({ isOk: false, error: { kind: 'DELIVERY_NOT_ACKNOWLEDGED' } });
    expect(stored(deliveryId)).toMatchObject({ state: 'notHandled' });
  });

  it('refuses a pending delivery: it is not in flight', async () => {
    const deliveryId = await sendTo(toScout());

    await expect(reportHandled(deliveryId)).resolves.toMatchObject({ isOk: false, error: { kind: 'DELIVERY_NOT_IN_FLIGHT' } });
  });

  it('refuses a delivery another ship holds', async () => {
    const deliveryId = await acknowledged();

    await expect(useCases.reportHandled(lookout, { deliveryId })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'DELIVERY_HELD_BY_ANOTHER_SHIP' },
    });
    expect(stored(deliveryId)).toMatchObject({ state: 'acknowledged' });
  });

  it('refuses a delivery that does not exist', async () => {
    await expect(reportHandled(core.ids('delivery'))).resolves.toMatchObject({ isOk: false, error: { kind: 'DELIVERY_NOT_FOUND' } });
  });

  it('refuses a crew whose lease ended: the delivery ends acknowledged, handled unknown', async () => {
    const deliveryId = await acknowledged();
    await releaseScout();

    await expect(reportHandled(deliveryId)).resolves.toMatchObject({ isOk: false, error: { kind: 'LEASE_ENDED' } });
    expect(stored(deliveryId)).toMatchObject({ state: 'acknowledged', claimedByLeaseId: scout.leaseId });
  });
});

describe("handled across a ship's leases (Bridge, CC12)", () => {
  /** A ship of the kind, crewed, sent a delivery its crew push received, handed and acknowledged, then released. */
  async function acknowledgedUnderAnEndedLease(kind: 'person' | 'agent'): Promise<{ deliveryId: DeliveryId; shipId: ShipId; endedLeaseId: Crew['leaseId'] }> {
    const { shipId } = unwrap(await registryUseCases(core).commissionShip(argo, { idempotencyKey: newKey(), name: `thomas-${kind}`, type: 'person', kind }));
    const first: Crew = { ...crewAboard(core, { fleetId, shipId }), kind };
    const deliveryId = await sendTo({ kind: 'ship', shipId });
    unwrap(await useCases.pushReceiveDeliveries(first, {}));
    unwrap(await useCases.handOverDelivery(first, { deliveryId, handOverNumber: 1 }));
    unwrap(await useCases.acknowledgeDelivery(first, { deliveryId }));
    const ended = await core.uow.run(async (tx) =>
      ok(await endLease({ tx, ids: core.ids }, { fleetId, leaseId: first.leaseId, actor: shipActor(argo.shipId), at: core.clock.now(), reason: 'released' })),
    );
    expect(ended).toEqual(ok(true));
    return { deliveryId, shipId, endedLeaseId: first.leaseId };
  }

  it("lets a person ship's next crew report handled a delivery acknowledged under its earlier lease", async () => {
    // Given a person ship's delivery acknowledged under a lease that ended.
    const { deliveryId, shipId, endedLeaseId } = await acknowledgedUnderAnEndedLease('person');
    const next: Crew = { ...crewAboard(core, { fleetId, shipId }), kind: 'person' };
    core.state.events.length = 0;

    // When the ship's next crew reports it handled.
    const reported = await useCases.reportHandled(next, { deliveryId });

    // Then it is handled, still naming the lease that took it, and the event names the reporting lease.
    expect(reported).toEqual(ok(undefined));
    expect(stored(deliveryId)).toMatchObject({ state: 'handled', claimedByShipId: shipId, claimedByLeaseId: endedLeaseId });
    expect(eventsOf('DeliveryHandled')).toMatchObject([{ shipId, deliveryId, details: { leaseId: next.leaseId } }]);
  });

  it("refuses another kind of ship's next crew a delivery acknowledged under its earlier lease: the per-lease rule", async () => {
    // Given an agent ship's delivery acknowledged under a lease that ended.
    const { deliveryId, shipId, endedLeaseId } = await acknowledgedUnderAnEndedLease('agent');
    const next = crewAboard(core, { fleetId, shipId });

    // When the ship's next crew reports it handled.
    const reported = await useCases.reportHandled(next, { deliveryId });

    // Then it is refused, and the delivery stays acknowledged under the lease that took it.
    expect(reported).toMatchObject({ isOk: false, error: { kind: 'DELIVERY_HELD_BY_ANOTHER_SHIP' } });
    expect(stored(deliveryId)).toMatchObject({ state: 'acknowledged', claimedByLeaseId: endedLeaseId });
  });
});
