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
import { unwrap } from '../../testing/result.js';
import { endLease } from '../registry/public.js';
import type { ShipCaller, Crew } from '../shared/caller.js';
import { shipActor } from '../shared/events.js';
import { ok } from '../shared/result.js';
import type { Selector } from '../shared/selector.js';
import { newKey } from '../../testing/keys.js';

let core: InMemoryCore;
let useCases: ReturnType<typeof messagingUseCases>;
let fleetId: FleetId;
let argo: ShipCaller;
let scoutId: ShipId;
let scout: Crew;
let lookout: Crew;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-01T10:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  const { commissionShip } = registryUseCases(core);
  ({ shipId: scoutId } = unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })));
  const { shipId: lookoutId } = unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'lookout', type: 'reviewer' }));
  unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'builder', type: 'builder' }));
  scout = crewAboard(core, { fleetId, shipId: scoutId });
  lookout = crewAboard(core, { fleetId, shipId: lookoutId });
  useCases = messagingUseCases(core);
  core.clock.advance(60_000);
});

const toScout = (): Selector => ({ kind: 'ship', shipId: scoutId });
const toReviewers: Selector = { kind: 'type', type: 'reviewer' };
const toBuilders: Selector = { kind: 'type', type: 'builder' };

async function sendTo(selector: Selector, options: { isForced?: boolean } = {}): Promise<DeliveryId> {
  const { messageId } = unwrap(
    await useCases.sendMessage(argo, {
      selector,
      payload: 'Review PR 48',
      idempotencyKey: `key-${core.ids('message')}`,
      ...options,
    }),
  );
  return deliveryIdOf(core, messageId);
}

async function waiting(crew: Crew, input: { waitSeconds?: number; knownWaiting?: number } = {}): Promise<number> {
  return unwrap(await useCases.checkInbox(crew, input)).waiting;
}

async function inboxOf(crew: Crew) {
  return unwrap(await useCases.checkInbox(crew, {}));
}

describe('checking the inbox', () => {
  it('counts what the next receive would hand the crew: pending to its ship and to its type', async () => {
    await sendTo(toScout());
    await sendTo(toReviewers);
    await sendTo(toBuilders);

    await expect(waiting(scout)).resolves.toBe(2);
  });

  it('counts the crew its own deliveries in flight, which its next receive hands it again', async () => {
    await sendTo(toScout());
    unwrap(await useCases.receiveDeliveries(scout, {}));

    await expect(waiting(scout)).resolves.toBe(1);
  });

  it('counts the crew its own push received deliveries, which its next push receive returns again', async () => {
    await sendTo(toScout());
    unwrap(await useCases.pushReceiveDeliveries(scout, {}));

    await expect(waiting(scout)).resolves.toBe(1);
  });

  it('leaves out what another crew holds, and what is acknowledged', async () => {
    await sendTo(toReviewers);
    unwrap(await useCases.receiveDeliveries(lookout, {}));
    const acknowledged = await sendTo(toScout());
    unwrap(await useCases.receiveDeliveries(scout, {}));
    unwrap(await useCases.acknowledgeDelivery(scout, { deliveryId: acknowledged }));

    await expect(waiting(scout)).resolves.toBe(0);
  });

  it('claims nothing: the delivery stays pending, and the next receive claims it for the first time', async () => {
    const deliveryId = await sendTo(toScout());

    await waiting(scout);

    expect(core.state.deliveries.find((delivery) => delivery.id === deliveryId)).toMatchObject({
      state: 'pending',
      attempts: 0,
    });
    expect(unwrap(await useCases.receiveDeliveries(scout, {})).deliveries).toMatchObject([{ deliveryId, attempts: 1 }]);
  });

  it('answers 0 at once without a wait', async () => {
    await expect(waiting(scout)).resolves.toBe(0);
    expect(core.wakeups.waits).toEqual([]);
  });

  it('waits for the seconds asked while nothing waits, then answers 0', async () => {
    const startedAt = core.clock.now().getTime();

    await expect(waiting(scout, { waitSeconds: 25 })).resolves.toBe(0);
    expect(core.wakeups.waits).toEqual([25_000]);
    expect(core.clock.now().getTime() - startedAt).toBe(25_000);
    expect(core.wakeups.watched).toEqual([{ fleetId, shipId: scoutId, type: 'reviewer' }]);
    expect(core.wakeups.watching()).toBe(0);
  });

  it('answers as soon as a delivery arrives while it waits', async () => {
    core.wakeups.nextWaits.push(async () => {
      core.clock.advance(3_000);
      await sendTo(toReviewers);
      return 'woken';
    });

    await expect(waiting(scout, { waitSeconds: 25 })).resolves.toBe(1);
    expect(core.wakeups.waits).toEqual([25_000]);
  });

  it('does not wait when something already waits', async () => {
    await sendTo(toScout());

    await expect(waiting(scout, { waitSeconds: 25 })).resolves.toBe(1);
    expect(core.wakeups.waits).toEqual([]);
  });

  it.each([-1, 26, 2.5])('refuses a wait of %j seconds: 0 to 25 whole seconds', async (waitSeconds) => {
    await expect(useCases.checkInbox(scout, { waitSeconds })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'INVALID_INBOX_WAIT' },
    });
  });

  it('refuses a crew whose lease has ended', async () => {
    const ended = await core.uow.run(async (tx) =>
      ok(
        await endLease(
          { tx, ids: core.ids },
          { fleetId, leaseId: scout.leaseId, actor: shipActor(argo.shipId), at: core.clock.now(), reason: 'released' },
        ),
      ),
    );
    expect(ended).toEqual(ok(true));

    await expect(useCases.checkInbox(scout, {})).resolves.toMatchObject({ isOk: false, error: { kind: 'LEASE_ENDED' } });
  });
});

describe('checking the inbox with the count the crew knows (W5)', () => {
  it('waits for the seconds asked while the count is still the one it knows, then answers it', async () => {
    await sendTo(toScout());
    await sendTo(toScout());
    const startedAt = core.clock.now().getTime();

    await expect(waiting(scout, { waitSeconds: 25, knownWaiting: 2 })).resolves.toBe(2);
    expect(core.fleetNews.waits).toEqual([25_000]);
    expect(core.clock.now().getTime() - startedAt).toBe(25_000);
    expect(core.fleetNews.watched).toEqual([fleetId]);
    expect(core.fleetNews.watching()).toBe(0);
  });

  it.each([
    { known: 0, sent: 1 },
    { known: 3, sent: 1 },
  ])('answers $sent at once when the crew knows $known', async ({ known, sent }) => {
    for (let index = 0; index < sent; index += 1) {
      await sendTo(toScout());
    }

    await expect(waiting(scout, { waitSeconds: 25, knownWaiting: known })).resolves.toBe(sent);
    expect(core.fleetNews.waits).toEqual([]);
  });

  it('answers as soon as a delivery arrives while it waits', async () => {
    await sendTo(toScout());
    core.fleetNews.nextWaits.push(async () => {
      core.clock.advance(3_000);
      await sendTo(toReviewers);
      return 'woken';
    });

    await expect(waiting(scout, { waitSeconds: 25, knownWaiting: 1 })).resolves.toBe(2);
    expect(core.fleetNews.waits).toEqual([25_000]);
  });

  it('answers as soon as the count goes down while it waits: the crew acknowledged one', async () => {
    const deliveryId = await sendTo(toScout());
    unwrap(await useCases.receiveDeliveries(scout, {}));
    core.fleetNews.nextWaits.push(async () => {
      core.clock.advance(3_000);
      unwrap(await useCases.acknowledgeDelivery(scout, { deliveryId }));
      return 'woken';
    });

    await expect(waiting(scout, { waitSeconds: 25, knownWaiting: 1 })).resolves.toBe(0);
  });

  it('goes on waiting for the rest of its wait on news that leaves the count as it knows it', async () => {
    await sendTo(toScout());
    core.fleetNews.nextWaits.push(async () => {
      core.clock.advance(5_000);
      await sendTo(toBuilders);
      return 'woken';
    });

    await expect(waiting(scout, { waitSeconds: 25, knownWaiting: 1 })).resolves.toBe(1);
    expect(core.fleetNews.waits).toEqual([25_000, 20_000]);
  });

  it('answers the forced count of its last look when the wait passes', async () => {
    await sendTo(toScout(), { isForced: true });

    await expect(useCases.checkInbox(scout, { waitSeconds: 25, knownWaiting: 1 })).resolves.toEqual(ok({ waiting: 1, forced: 1 }));
  });

  it('refuses as soon as the lease ends while it waits', async () => {
    core.fleetNews.nextWaits.push(async () => {
      await core.uow.run(async (tx) =>
        ok(
          await endLease(
            { tx, ids: core.ids },
            { fleetId, leaseId: scout.leaseId, actor: shipActor(argo.shipId), at: core.clock.now(), reason: 'released' },
          ),
        ),
      );
      return 'woken';
    });

    await expect(useCases.checkInbox(scout, { waitSeconds: 25, knownWaiting: 0 })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'LEASE_ENDED' },
    });
  });

  it('watches only the ship and its type without a known count, as before', async () => {
    await waiting(scout, { waitSeconds: 25 });

    expect(core.fleetNews.watched).toEqual([]);
  });
});

describe('forced deliveries in the inbox (decision 0040)', () => {
  it('counts the forced ones apart, to its ship and to its type, among all that wait', async () => {
    await sendTo(toScout(), { isForced: true });
    await sendTo(toReviewers, { isForced: true });
    await sendTo(toScout());

    await expect(inboxOf(scout)).resolves.toEqual({ waiting: 3, forced: 2 });
  });

  it('counts none when nothing forced waits', async () => {
    await sendTo(toScout());

    await expect(inboxOf(scout)).resolves.toEqual({ waiting: 1, forced: 0 });
  });

  it('counts a forced one the crew push received and did not hand over yet', async () => {
    await sendTo(toScout(), { isForced: true });
    unwrap(await useCases.pushReceiveDeliveries(scout, {}));

    await expect(inboxOf(scout)).resolves.toEqual({ waiting: 1, forced: 1 });
  });

  it('leaves out a forced one handed over: it is the session\'s to confirm', async () => {
    const deliveryId = await sendTo(toScout(), { isForced: true });
    unwrap(await useCases.pushReceiveDeliveries(scout, {}));
    unwrap(await useCases.handOverDelivery(scout, { deliveryId, handOverNumber: 1 }));

    await expect(inboxOf(scout)).resolves.toEqual({ waiting: 1, forced: 0 });
  });

  it('leaves out a forced one a plain receive handed', async () => {
    await sendTo(toScout(), { isForced: true });
    unwrap(await useCases.receiveDeliveries(scout, {}));

    await expect(inboxOf(scout)).resolves.toEqual({ waiting: 1, forced: 0 });
  });

  it('leaves out a forced one another crew of its type holds', async () => {
    await sendTo(toReviewers, { isForced: true });
    unwrap(await useCases.pushReceiveDeliveries(lookout, {}));

    await expect(inboxOf(scout)).resolves.toEqual({ waiting: 0, forced: 0 });
  });
});
