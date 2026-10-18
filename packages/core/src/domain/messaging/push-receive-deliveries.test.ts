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
import { RECEIVE_WAIT_MS } from './receive-deliveries.js';

let core: InMemoryCore;
let useCases: ReturnType<typeof messagingUseCases>;
let fleetId: FleetId;
let argo: Caller;
let scoutId: ShipId;
let scout: Crew;
let lookoutId: ShipId;
let lookout: Crew;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-12T12:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  const { commissionShip } = registryUseCases(core);
  ({ shipId: scoutId } = unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })));
  ({ shipId: lookoutId } = unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'lookout', type: 'reviewer' })));
  scout = crewAboard(core, { fleetId, shipId: scoutId });
  lookout = crewAboard(core, { fleetId, shipId: lookoutId });
  useCases = messagingUseCases(core);
  core.clock.advance(60_000);
  core.state.events.length = 0;
});

const toScout = (): Selector => ({ kind: 'ship', shipId: scoutId });
const toReviewers: Selector = { kind: 'type', type: 'reviewer' };

async function sendTo(selector: Selector, options: { isForced?: boolean } = {}): Promise<DeliveryId> {
  const { messageId } = unwrap(
    await useCases.sendMessage(argo, {
      selector,
      payload: 'Review https://github.com/ThomasHendrickx/aeolus-fleet/pull/25',
      contentType: 'text/plain',
      idempotencyKey: `review-${core.ids('message')}`,
      ...options,
    }),
  );
  return deliveryIdOf(core, messageId);
}

/** The ids of the deliveries one push receive returns. */
async function pushReceive(crew: Crew, max?: number): Promise<DeliveryId[]> {
  const { deliveries } = unwrap(await useCases.pushReceiveDeliveries(crew, max === undefined ? {} : { max }));
  return deliveries.map((delivery) => delivery.deliveryId);
}

function stored(deliveryId: DeliveryId) {
  return core.state.deliveries.find((held) => held.id === deliveryId);
}

function eventsOf(type: string) {
  return core.state.events.filter((event) => event.type === type);
}

async function endLeaseOf(crew: Crew): Promise<void> {
  const ended = await core.uow.run(async (tx) =>
    ok(
      await endLease(
        { tx, ids: core.ids },
        { fleetId, leaseId: crew.leaseId, actor: shipActor(argo.shipId), at: core.clock.now(), reason: 'released' },
      ),
    ),
  );
  expect(ended).toEqual(ok(true));
}

describe('a push receive', () => {
  it("marks a pending delivery received, in flight with the ship and its crew's lease, and counts no attempt", async () => {
    const deliveryId = await sendTo(toScout());

    expect(await pushReceive(scout)).toEqual([deliveryId]);
    expect(stored(deliveryId)).toMatchObject({
      state: 'received',
      claimedByShipId: scoutId,
      claimedByLeaseId: scout.leaseId,
      attempts: 0,
      handOverNumber: null,
    });
  });

  it('hands over the message and its sender, with the state received and no hand-over number yet', async () => {
    const deliveryId = await sendTo(toScout());
    const [message] = core.state.messages;

    const received = unwrap(await useCases.pushReceiveDeliveries(scout, {}));

    expect(received).toEqual({
      deliveries: [
        {
          deliveryId,
          messageId: message?.id,
          senderShipId: argo.shipId,
          senderName: 'argo',
          senderType: 'operator',
          recipient: { kind: 'ship', shipId: scoutId },
          payload: 'Review https://github.com/ThomasHendrickx/aeolus-fleet/pull/25',
          contentType: 'text/plain',
          model: null,
          inReplyTo: null,
          sentAt: message?.createdAt,
          attempts: 0,
          isForced: false,
          state: 'received',
          handOverNumber: null,
        },
      ],
    });
  });

  it('writes DeliveryReceived, caused by the receiving ship, naming its lease', async () => {
    const deliveryId = await sendTo(toScout());

    await pushReceive(scout);

    const [event] = eventsOf('DeliveryReceived');
    expect(eventsOf('DeliveryReceived')).toEqual([
      {
        id: event?.id,
        fleetId,
        type: 'DeliveryReceived',
        occurredAt: core.clock.now(),
        actor: { kind: 'ship', shipId: scoutId },
        shipId: scoutId,
        messageId: stored(deliveryId)?.messageId,
        deliveryId,
        details: { leaseId: scout.leaseId },
      },
    ]);
    expect(eventsOf('DeliveryHanded')).toEqual([]);
  });

  it('takes a type delivery for one ship of the type: the other ship never gets it', async () => {
    const deliveryId = await sendTo(toReviewers);

    expect(await pushReceive(scout)).toEqual([deliveryId]);
    expect(await pushReceive(lookout)).toEqual([]);
  });

  it('returns up to max, oldest first, and refuses a max out of range', async () => {
    const [first, second] = [await sendTo(toScout()), await sendTo(toScout()), await sendTo(toScout())];

    expect(await pushReceive(scout, 2)).toEqual([first, second]);
    await expect(useCases.pushReceiveDeliveries(scout, { max: 11 })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'INVALID_RECEIVE_MAX' },
    });
  });

  it('is refused once its lease has ended, and receives nothing', async () => {
    const deliveryId = await sendTo(toScout());
    await endLeaseOf(scout);

    await expect(useCases.pushReceiveDeliveries(scout, {})).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'LEASE_ENDED' },
    });
    expect(stored(deliveryId)?.state).toBe('pending');
  });

  it('waits about 25 seconds on an empty inbox, then returns nothing', async () => {
    const startedAt = core.clock.now().getTime();

    expect(await pushReceive(scout)).toEqual([]);
    expect(core.clock.now().getTime() - startedAt).toBe(RECEIVE_WAIT_MS);
  });
});

describe('received again', () => {
  it('returns its own received delivery again, first, with no change and no attempt counted', async () => {
    const deliveryId = await sendTo(toScout());
    await pushReceive(scout);
    const before = structuredClone(stored(deliveryId));
    const later = await sendTo(toScout());

    expect(await pushReceive(scout, 2)).toEqual([deliveryId, later]);
    expect(stored(deliveryId)).toEqual(before);
  });

  it('writes DeliveryReceived marked again', async () => {
    const deliveryId = await sendTo(toScout());
    await pushReceive(scout);

    await pushReceive(scout);

    expect(eventsOf('DeliveryReceived').map((event) => event.details)).toEqual([
      { leaseId: scout.leaseId },
      { leaseId: scout.leaseId, again: true },
    ]);
    expect(eventsOf('DeliveryReceived').map((event) => event.deliveryId)).toEqual([deliveryId, deliveryId]);
  });

  it('returns its own handed delivery with the state handed and its hand-over number, changing nothing', async () => {
    const deliveryId = await sendTo(toScout());
    await pushReceive(scout);
    unwrap(await useCases.handOverDelivery(scout, { deliveryId, handOverNumber: 2 }));
    const before = structuredClone(stored(deliveryId));

    const { deliveries } = unwrap(await useCases.pushReceiveDeliveries(scout, {}));

    expect(deliveries).toMatchObject([{ deliveryId, state: 'handed', handOverNumber: 2, attempts: 1 }]);
    expect(stored(deliveryId)).toEqual(before);
  });
});

describe('a pushed lease', () => {
  it('answers a plain receive with nothing, claiming nothing, its pending deliveries included', async () => {
    await pushReceive(scout);
    const deliveryId = await sendTo(toScout());

    const { deliveries } = unwrap(await useCases.receiveDeliveries(scout, {}));

    expect(deliveries).toEqual([]);
    expect(stored(deliveryId)).toMatchObject({ state: 'pending', attempts: 0 });
    expect(eventsOf('DeliveryHanded')).toEqual([]);
  });

  it('answers a plain receive with nothing for what its push side holds', async () => {
    const deliveryId = await sendTo(toScout());
    await pushReceive(scout);

    const { deliveries } = unwrap(await useCases.receiveDeliveries(scout, {}));

    expect(deliveries).toEqual([]);
    expect(stored(deliveryId)).toMatchObject({ state: 'received', attempts: 0 });
  });

  it('writes LeasePushed once, at its first push receive, caused by the ship and naming the lease', async () => {
    const pushedAt = core.clock.now();
    await pushReceive(scout);
    await sendTo(toScout());
    await pushReceive(scout);

    const [event] = eventsOf('LeasePushed');
    expect(eventsOf('LeasePushed')).toEqual([
      {
        id: event?.id,
        fleetId,
        type: 'LeasePushed',
        occurredAt: pushedAt,
        actor: { kind: 'ship', shipId: scoutId },
        shipId: scoutId,
        details: { leaseId: scout.leaseId },
      },
    ]);
  });

  it('writes LeasePushed before the DeliveryReceived of its first push receive', async () => {
    await sendTo(toScout());

    await pushReceive(scout);

    expect(core.state.events.map((event) => event.type)).toEqual(['MessageAccepted', 'LeasePushed', 'DeliveryReceived']);
  });

  it('writes LeasePushed again for the next lease of the ship, at its own first push receive', async () => {
    await pushReceive(scout);
    await endLeaseOf(scout);
    const nextCrew = crewAboard(core, { fleetId, shipId: scoutId });

    await pushReceive(nextCrew);

    expect(eventsOf('LeasePushed').map((event) => event.details)).toEqual([{ leaseId: scout.leaseId }, { leaseId: nextCrew.leaseId }]);
  });

  it('is pushed from a push receive that found nothing', async () => {
    await pushReceive(scout);
    await sendTo(toScout());

    expect(unwrap(await useCases.receiveDeliveries(scout, {})).deliveries).toEqual([]);
  });

  it('ends with its lease: the next lease of the ship is pull until its first push receive', async () => {
    await pushReceive(scout);
    await endLeaseOf(scout);
    const nextCrew = crewAboard(core, { fleetId, shipId: scoutId });
    const deliveryId = await sendTo(toScout());

    const { deliveries } = unwrap(await useCases.receiveDeliveries(nextCrew, {}));

    expect(deliveries.map((delivery) => delivery.deliveryId)).toEqual([deliveryId]);
  });

  it('leaves the other leases of the fleet pull', async () => {
    await pushReceive(scout);
    const deliveryId = await sendTo(toReviewers);

    const { deliveries } = unwrap(await useCases.receiveDeliveries(lookout, {}));

    expect(deliveries.map((delivery) => delivery.deliveryId)).toEqual([deliveryId]);
  });
});

describe('a lease that ends holding received and handed deliveries', () => {
  it('returns them to pending, their claim and hand-over number cleared, their attempts kept', async () => {
    const received = await sendTo(toScout());
    const handed = await sendTo(toScout());
    await pushReceive(scout, 2);
    unwrap(await useCases.handOverDelivery(scout, { deliveryId: handed, handOverNumber: 1 }));

    await endLeaseOf(scout);

    expect(stored(received)).toMatchObject({ state: 'pending', claimedByShipId: null, claimedByLeaseId: null, handOverNumber: null, attempts: 0 });
    expect(stored(handed)).toMatchObject({ state: 'pending', claimedByShipId: null, claimedByLeaseId: null, handOverNumber: null, attempts: 1 });
  });

  it('lets the next crew receive them again', async () => {
    const deliveryId = await sendTo(toReviewers);
    await pushReceive(scout);

    await endLeaseOf(scout);

    expect(await pushReceive(lookout)).toEqual([deliveryId]);
  });
});

describe('a ship retired holding received and handed deliveries', () => {
  it('abandons those to the ship and returns those to its type to pending', async () => {
    const toShip = await sendTo(toScout());
    const toType = await sendTo(toReviewers);
    await pushReceive(scout, 2);
    unwrap(await useCases.handOverDelivery(scout, { deliveryId: toShip, handOverNumber: 1 }));

    unwrap(await registryUseCases(core).retireShip(argo, { shipId: scoutId }));

    expect(stored(toShip)?.state).toBe('abandoned');
    expect(stored(toType)).toMatchObject({ state: 'pending', claimedByShipId: null });
  });
});

describe('a forced delivery (decision 0040)', () => {
  it('comes first, before older pending deliveries', async () => {
    const older = await sendTo(toScout());
    const forced = await sendTo(toScout(), { isForced: true });

    expect(await pushReceive(scout, 2)).toEqual([forced, older]);
  });

  it('comes first with one at a time: the older pending delivery waits', async () => {
    const older = await sendTo(toScout());
    const forced = await sendTo(toScout(), { isForced: true });

    expect(await pushReceive(scout)).toEqual([forced]);
    expect(stored(older)?.state).toBe('pending');
  });

  it("comes before the crew's own delivery in flight", async () => {
    const inFlight = await sendTo(toScout());
    expect(await pushReceive(scout)).toEqual([inFlight]);
    const forced = await sendTo(toScout(), { isForced: true });

    expect(await pushReceive(scout, 2)).toEqual([forced, inFlight]);
  });

  it('comes first to its type as well', async () => {
    const older = await sendTo(toReviewers);
    const forced = await sendTo(toReviewers, { isForced: true });

    expect(await pushReceive(scout)).toEqual([forced]);
    expect(stored(older)?.state).toBe('pending');
  });

  it('says it was forced, and a plain one says it was not', async () => {
    const forced = await sendTo(toScout(), { isForced: true });
    const plain = await sendTo(toScout());

    expect(unwrap(await useCases.pushReceiveDeliveries(scout, { max: 2 })).deliveries).toMatchObject([
      { deliveryId: forced, isForced: true },
      { deliveryId: plain, isForced: false },
    ]);
  });

  it('keeps the oldest first among forced deliveries', async () => {
    const first = await sendTo(toScout(), { isForced: true });
    const second = await sendTo(toScout(), { isForced: true });

    expect(await pushReceive(scout, 2)).toEqual([first, second]);
  });
});
