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
import { endLease } from '../registry/public.js';
import type { Caller, Crew } from '../shared/caller.js';
import { shipActor } from '../shared/events.js';
import { ok } from '../shared/result.js';
import type { Selector } from '../shared/selector.js';
import { newKey } from '../../../test/support/keys.js';

let core: InMemoryCore;
let useCases: ReturnType<typeof messagingUseCases>;
let fleetId: FleetId;
let argo: Caller;
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

async function sendTo(selector: Selector): Promise<DeliveryId> {
  const { messageId } = unwrap(
    await useCases.sendMessage(argo, {
      selector,
      payload: 'Review PR 48',
      idempotencyKey: `key-${core.ids('message')}`,
    }),
  );
  return deliveryIdOf(core, messageId);
}

async function waiting(crew: Crew, input: { waitSeconds?: number } = {}): Promise<number> {
  return unwrap(await useCases.checkInbox(crew, input)).waiting;
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
