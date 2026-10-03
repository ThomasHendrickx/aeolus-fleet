import type { DeliveryId, FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  crewAboard,
  deliveryIdOf,
  initialiseFleet,
  messagingUseCases,
  operatorCaller,
  registryUseCases,
  modelOf,
} from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import { endLease } from '../registry/public.js';
import type { Caller, Crew } from '../shared/caller.js';
import { shipActor } from '../shared/events.js';
import { ok } from '../shared/result.js';
import type { Selector } from '../shared/selector.js';
import { RECEIVE_WAIT_MS } from './receive-deliveries.js';
import { newKey } from '../../../test/support/keys.js';

let core: InMemoryCore;
let useCases: ReturnType<typeof messagingUseCases>;
let fleetId: FleetId;
let argo: Caller;
let scoutId: ShipId;
let scout: Crew;
let lookoutId: ShipId;
let lookout: Crew;

beforeEach(async () => {
  core = createInMemoryCore('2026-09-30T12:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  const { commissionShip } = registryUseCases(core);
  ({ shipId: scoutId } = unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })));
  ({ shipId: lookoutId } = unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'lookout', type: 'reviewer' })));
  unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'builder', type: 'builder' }));
  scout = crewAboard(core, { fleetId, shipId: scoutId });
  lookout = crewAboard(core, { fleetId, shipId: lookoutId });
  useCases = messagingUseCases(core);
  core.clock.advance(60_000);
  core.state.events.length = 0;
});

const toScout = (): Selector => ({ kind: 'ship', shipId: scoutId });
const toReviewers: Selector = { kind: 'type', type: 'reviewer' };

/** Sends a plain-text message from argo and returns its delivery's id. */
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

/** The ids of the deliveries one receive returns. */
async function receive(crew: Crew, max?: number): Promise<DeliveryId[]> {
  const { deliveries } = unwrap(await useCases.receiveDeliveries(crew, max === undefined ? {} : { max }));
  return deliveries.map((delivery) => delivery.deliveryId);
}

function stored(deliveryId: DeliveryId) {
  return core.state.deliveries.find((held) => held.id === deliveryId);
}

function eventsOf(type: string) {
  return core.state.events.filter((event) => event.type === type);
}

/** Ends the crew's lease as argo's release does: what it held in flight returns to pending. */
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

describe('how many deliveries a receive returns', () => {
  it('returns one when the ship does not say how many', async () => {
    const first = await sendTo(toScout());
    const second = await sendTo(toScout());

    expect(await receive(scout)).toEqual([first]);
    expect(stored(second)?.state).toBe('pending');
  });

  it('returns up to max, oldest first', async () => {
    const [first, second] = [await sendTo(toScout()), await sendTo(toScout()), await sendTo(toScout())];

    expect(await receive(scout, 2)).toEqual([first, second]);
  });

  it('returns ten at most, when the ship asks for ten', async () => {
    const sent: DeliveryId[] = [];
    for (let count = 0; count < 11; count += 1) {
      sent.push(await sendTo(toScout()));
    }

    expect(await receive(scout, 10)).toEqual(sent.slice(0, 10));
  });

  it.each([
    ['zero', 0],
    ['eleven', 11],
    ['a fraction', 2.5],
  ])('refuses a max of %s, and claims nothing', async (_label, max) => {
    const deliveryId = await sendTo(toScout());

    await expect(useCases.receiveDeliveries(scout, { max })).resolves.toEqual({
      isOk: false,
      error: { kind: 'INVALID_RECEIVE_MAX', message: 'A receive returns 1 to 10 deliveries at once' },
    });
    expect(stored(deliveryId)).toMatchObject({ state: 'pending', attempts: 0 });
    expect(eventsOf('DeliveryClaimed')).toEqual([]);
  });
});

describe('claiming a delivery', () => {
  it("marks it in flight, claimed by the ship and its crew's lease, with one attempt, and hands over its message and its sender's id, name and type", async () => {
    const deliveryId = await sendTo(toScout());
    const [message] = core.state.messages;

    const received = unwrap(await useCases.receiveDeliveries(scout, {}));

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
          inReplyTo: null,
          sentAt: message?.createdAt,
          attempts: 1,
        },
      ],
    });
    expect(stored(deliveryId)).toMatchObject({
      state: 'delivered',
      claimedByShipId: scoutId,
      claimedByLeaseId: scout.leaseId,
      attempts: 1,
    });
  });

  it('writes DeliveryClaimed, caused by the receiving ship, on its timeline', async () => {
    const deliveryId = await sendTo(toScout());

    await receive(scout);

    const [event] = eventsOf('DeliveryClaimed');
    expect(event?.id).toMatch(/^evt_/);
    expect(eventsOf('DeliveryClaimed')).toEqual([
      {
        id: event?.id,
        fleetId,
        type: 'DeliveryClaimed',
        occurredAt: core.clock.now(),
        actor: { kind: 'ship', shipId: scoutId },
        shipId: scoutId,
        messageId: stored(deliveryId)?.messageId,
        deliveryId,
        details: { leaseId: scout.leaseId, attempts: 1 },
      },
    ]);
  });

  it('claims the deliveries to its type as well as its own, oldest first', async () => {
    const toType = await sendTo(toReviewers);
    const toShip = await sendTo(toScout());

    expect(await receive(scout, 2)).toEqual([toType, toShip]);
    expect(stored(toType)).toMatchObject({ state: 'delivered', claimedByShipId: scoutId });
  });

  it('never claims a delivery for another ship or for another type', async () => {
    const toLookout = await sendTo({ kind: 'ship', shipId: lookoutId });
    const toBuilders = await sendTo({ kind: 'type', type: 'builder' });

    expect(await receive(scout, 10)).toEqual([]);
    expect([stored(toLookout)?.state, stored(toBuilders)?.state]).toEqual(['pending', 'pending']);
  });

  it('never returns a type delivery that another crew holds in flight', async () => {
    const deliveryId = await sendTo(toReviewers);
    expect(await receive(lookout)).toEqual([deliveryId]);

    expect(await receive(scout)).toEqual([]);
    expect(stored(deliveryId)).toMatchObject({ claimedByShipId: lookoutId, attempts: 1 });
  });
});

describe('the sender of a delivery', () => {
  it('goes by the name it has now: renamed after the send, it is handed over with its new name and its type', async () => {
    const { messageId } = unwrap(
      await useCases.sendMessage(lookout, { ...modelOf(lookout),
        selector: toScout(),
        payload: 'Can you take https://github.com/ThomasHendrickx/aeolus-fleet/pull/25?',
        idempotencyKey: 'ask-scout',
      }),
    );
    const sender = core.state.ships.find((ship) => ship.id === lookoutId);
    if (sender) {
      sender.name = 'watch';
    }

    const { deliveries } = unwrap(await useCases.receiveDeliveries(scout, {}));

    expect(deliveries).toEqual([
      expect.objectContaining({ messageId, senderShipId: lookoutId, senderName: 'watch', senderType: 'reviewer' }),
    ]);
  });
});

describe("a crew's own delivery in flight", () => {
  it('is returned again by its next receive, and that counts as a claim', async () => {
    const deliveryId = await sendTo(toScout());
    await receive(scout);

    expect(await receive(scout)).toEqual([deliveryId]);
    expect(stored(deliveryId)).toMatchObject({ state: 'delivered', claimedByLeaseId: scout.leaseId, attempts: 2 });
    expect(eventsOf('DeliveryClaimed').map((event) => event.details)).toEqual([
      { leaseId: scout.leaseId, attempts: 1 },
      { leaseId: scout.leaseId, attempts: 2 },
    ]);
  });

  it('comes before an older pending delivery, within max', async () => {
    const older = await sendTo(toReviewers);
    const newer = await sendTo(toScout());
    expect(await receive(lookout)).toEqual([older]);
    expect(await receive(scout)).toEqual([newer]);
    await endLeaseOf(lookout);

    expect(await receive(scout)).toEqual([newer]);
    expect(stored(older)).toMatchObject({ state: 'pending', attempts: 1 });
  });

  it('leaves the rest of max to pending deliveries, oldest first', async () => {
    const older = await sendTo(toReviewers);
    const newer = await sendTo(toScout());
    expect(await receive(lookout)).toEqual([older]);
    expect(await receive(scout)).toEqual([newer]);
    await endLeaseOf(lookout);

    expect(await receive(scout, 2)).toEqual([newer, older]);
  });
});

describe('the fifth claim without an acknowledgement', () => {
  it('makes the delivery undeliverable instead of returning it', async () => {
    const deliveryId = await sendTo(toScout());
    const handedOut: DeliveryId[][] = [];
    for (let claim = 1; claim <= 4; claim += 1) {
      handedOut.push(await receive(scout));
    }

    expect(await receive(scout)).toEqual([]);
    expect(handedOut).toEqual([[deliveryId], [deliveryId], [deliveryId], [deliveryId]]);
    expect(stored(deliveryId)).toMatchObject({
      state: 'undeliverable',
      claimedByShipId: null,
      claimedByLeaseId: null,
      attempts: 5,
    });
  });

  it('writes DeliveryUndeliverable, caused by the receiving ship, on its timeline', async () => {
    const deliveryId = await sendTo(toScout());
    for (let claim = 1; claim <= 5; claim += 1) {
      await receive(scout);
    }

    expect(eventsOf('DeliveryUndeliverable')).toEqual([
      expect.objectContaining({
        fleetId,
        actor: { kind: 'ship', shipId: scoutId },
        shipId: scoutId,
        messageId: stored(deliveryId)?.messageId,
        deliveryId,
        details: { leaseId: scout.leaseId, attempts: 5 },
      }),
    ]);
    expect(eventsOf('DeliveryClaimed')).toHaveLength(4);
  });

  it('lets the next delivery take its place within max', async () => {
    const poison = await sendTo(toScout());
    const next = await sendTo(toScout());
    for (let claim = 1; claim <= 4; claim += 1) {
      await receive(scout);
    }

    expect(await receive(scout)).toEqual([next]);
    expect(stored(poison)?.state).toBe('undeliverable');
  });

  it('counts the claims of every crew: after four, the next crew makes it undeliverable', async () => {
    const deliveryId = await sendTo(toReviewers);
    for (let claim = 1; claim <= 4; claim += 1) {
      await receive(scout);
    }
    await endLeaseOf(scout);

    expect(await receive(lookout)).toEqual([]);
    expect(stored(deliveryId)).toMatchObject({ state: 'undeliverable', attempts: 5 });
  });
});

describe('a crew whose lease has ended', () => {
  it('is refused, and claims nothing', async () => {
    const deliveryId = await sendTo(toScout());
    await endLeaseOf(scout);

    await expect(useCases.receiveDeliveries(scout, {})).resolves.toEqual({
      isOk: false,
      error: { kind: 'LEASE_ENDED', message: 'This ship was released; this session no longer crews it.' },
    });
    expect(stored(deliveryId)).toMatchObject({ state: 'pending', attempts: 0 });
    expect(core.wakeups.waits).toEqual([]);
  });
});

describe('waiting for a delivery', () => {
  it('does not wait when a delivery is there', async () => {
    await sendTo(toScout());

    await receive(scout);

    expect(core.wakeups.waits).toEqual([]);
    expect(core.wakeups.watched).toEqual([]);
  });

  it('waits about 25 seconds on an empty inbox, then returns nothing', async () => {
    const startedAt = core.clock.now().getTime();

    expect(await receive(scout)).toEqual([]);
    expect(RECEIVE_WAIT_MS).toBe(25_000);
    expect(core.wakeups.waits).toEqual([25_000]);
    expect(core.clock.now().getTime() - startedAt).toBe(25_000);
  });

  it('watches its ship and its type while it waits, and stops watching once it returns', async () => {
    await receive(scout);

    expect(core.wakeups.watched).toEqual([{ fleetId, shipId: scoutId, type: 'reviewer' }]);
    expect(core.wakeups.watching()).toBe(0);
  });

  it('returns a delivery sent while it waits, as soon as it is woken', async () => {
    const sent: DeliveryId[] = [];
    core.wakeups.nextWaits.push(async () => {
      core.clock.advance(3_000);
      sent.push(await sendTo(toReviewers));
      return 'woken';
    });

    expect(await receive(scout)).toEqual(sent);
    expect(sent).toHaveLength(1);
    expect(core.wakeups.waits).toEqual([25_000]);
  });

  it('waits out the rest of its wait when a wake-up brings nothing for it', async () => {
    core.wakeups.nextWaits.push(() => {
      core.clock.advance(10_000);
      return Promise.resolve('woken');
    });

    expect(await receive(scout)).toEqual([]);
    expect(core.wakeups.waits).toEqual([25_000, 15_000]);
  });

  it('is refused when its lease ends while it waits, and never holds the release up', async () => {
    core.wakeups.nextWaits.push(async () => {
      await endLeaseOf(scout);
      return 'woken';
    });

    await expect(useCases.receiveDeliveries(scout, {})).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'LEASE_ENDED' },
    });
    expect(core.wakeups.watching()).toBe(0);
  });

  it('hands nothing to its crew when a delivery wakes it after its ship was released', async () => {
    const sent: DeliveryId[] = [];
    core.wakeups.nextWaits.push(async () => {
      await endLeaseOf(scout);
      sent.push(await sendTo(toScout()));
      return 'woken';
    });

    await expect(useCases.receiveDeliveries(scout, {})).resolves.toMatchObject({ isOk: false });
    expect(sent.map((deliveryId) => stored(deliveryId))).toEqual([
      expect.objectContaining({ state: 'pending', claimedByLeaseId: null, attempts: 0 }),
    ]);
  });

  it('returns without deliveries at the end of its wait when its ship is released and nothing wakes it', async () => {
    core.wakeups.nextWaits.push(async () => {
      await endLeaseOf(scout);
      core.clock.advance(RECEIVE_WAIT_MS);
      return 'timedOut';
    });

    await expect(useCases.receiveDeliveries(scout, {})).resolves.toEqual({ isOk: true, value: { deliveries: [] } });
  });
});
