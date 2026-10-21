import type { DeliveryId, FleetId, MessageId, ShipId } from '@aeolus-fleet/common';
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
import type { Crew, ShipCaller } from '../shared/caller.js';
import { shipActor } from '../shared/events.js';
import { ok } from '../shared/result.js';
import { createReadDelivery } from './read-delivery.js';

let core: InMemoryCore;
let useCases: ReturnType<typeof messagingUseCases>;
let readDelivery: ReturnType<typeof createReadDelivery>;
let fleetId: FleetId;
let argo: ShipCaller;
let scoutId: ShipId;
let lookoutId: ShipId;
let scout: Crew;
let lookout: Crew;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-21T12:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  const { commissionShip } = registryUseCases(core);
  ({ shipId: scoutId } = unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })));
  ({ shipId: lookoutId } = unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'lookout', type: 'watcher' })));
  scout = crewAboard(core, { fleetId, shipId: scoutId });
  lookout = crewAboard(core, { fleetId, shipId: lookoutId });
  useCases = messagingUseCases(core);
  readDelivery = createReadDelivery({ uow: core.uow });
  core.clock.advance(60_000);
});

const PAYLOAD = 'Review https://github.com/ThomasHendrickx/aeolus-fleet/pull/25';

async function sendFrom(sender: ShipCaller, to: { shipId: ShipId; inReplyTo?: MessageId }): Promise<{ messageId: MessageId; deliveryId: DeliveryId }> {
  const { messageId } = unwrap(
    await useCases.sendMessage(sender, {
      selector: { kind: 'ship', shipId: to.shipId },
      payload: PAYLOAD,
      contentType: 'text/markdown',
      idempotencyKey: newKey(),
      ...(sender.shipId === argo.shipId ? {} : { model: 'claude-opus-5-5' }),
      ...(to.inReplyTo && { inReplyTo: to.inReplyTo }),
    }),
  );
  return { messageId, deliveryId: deliveryIdOf(core, messageId) };
}

/** A delivery to the scout, push received by its crew: received, not yet handed. */
async function received(): Promise<DeliveryId> {
  const { deliveryId } = await sendFrom(argo, { shipId: scoutId });
  unwrap(await useCases.pushReceiveDeliveries(scout, {}));
  return deliveryId;
}

/** A delivery to the scout, push received and handed as number 1, not acknowledged. */
async function handed(): Promise<DeliveryId> {
  const deliveryId = await received();
  unwrap(await useCases.handOverDelivery(scout, { deliveryId, handOverNumber: 1 }));
  return deliveryId;
}

/** A delivery to the scout, handed as number 1 and acknowledged by the hook. */
async function acknowledged(): Promise<DeliveryId> {
  const deliveryId = await handed();
  unwrap(await useCases.acknowledgeDelivery(scout, { deliveryId }));
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

describe('delivery, re-read', () => {
  it('answers an acknowledged delivery of the crew lease whole, as receive hands one, with its state', async () => {
    const { messageId: question } = await sendFrom(scout, { shipId: lookoutId });
    const { messageId, deliveryId } = await sendFrom(lookout, { shipId: scoutId, inReplyTo: question });
    unwrap(await useCases.pushReceiveDeliveries(scout, {}));
    unwrap(await useCases.handOverDelivery(scout, { deliveryId, handOverNumber: 1 }));
    unwrap(await useCases.acknowledgeDelivery(scout, { deliveryId }));

    await expect(readDelivery(scout, { deliveryId })).resolves.toEqual(
      ok({
        deliveryId,
        messageId,
        senderShipId: lookoutId,
        senderName: 'lookout',
        senderType: 'watcher',
        recipient: { kind: 'ship', shipId: scoutId },
        payload: PAYLOAD,
        contentType: 'text/markdown',
        model: 'claude-opus-5-5',
        inReplyTo: question,
        sentAt: new Date('2026-10-21T12:01:00.000Z'),
        attempts: 1,
        isForced: false,
        state: 'acknowledged',
      }),
    );
  });

  it('changes nothing: the delivery keeps its state, attempts and clocks, and no event is written', async () => {
    const deliveryId = await acknowledged();
    const before = structuredClone(stored(deliveryId));
    const eventsBefore = core.state.events.length;
    core.clock.advance(60_000);

    unwrap(await readDelivery(scout, { deliveryId }));
    unwrap(await readDelivery(scout, { deliveryId }));

    expect(stored(deliveryId)).toEqual(before);
    expect(core.state.events).toHaveLength(eventsBefore);
  });

  it('leaves what the next receive would hand as it was', async () => {
    const deliveryId = await acknowledged();

    unwrap(await readDelivery(scout, { deliveryId }));

    await expect(useCases.checkInbox(scout, {})).resolves.toEqual(ok({ waiting: 0, forced: 0 }));
  });

  it('re-reads a delivery handed once more, which stays acknowledged', async () => {
    const deliveryId = await acknowledged();
    unwrap(await useCases.handOverDelivery(scout, { deliveryId, handOverNumber: 2, isOnceMore: true }));

    await expect(readDelivery(scout, { deliveryId })).resolves.toMatchObject({ isOk: true, value: { deliveryId, state: 'acknowledged' } });
  });

  it('re-reads on a pull lease: a delivery acknowledged after a plain receive', async () => {
    const { deliveryId } = await sendFrom(argo, { shipId: lookoutId });
    unwrap(await useCases.receiveDeliveries(lookout, {}));
    unwrap(await useCases.acknowledgeDelivery(lookout, { deliveryId }));

    await expect(readDelivery(lookout, { deliveryId })).resolves.toMatchObject({ isOk: true, value: { deliveryId, payload: PAYLOAD } });
  });
});

describe('delivery, re-read refused', () => {
  it('refuses a handled delivery of the crew lease, naming its state', async () => {
    const deliveryId = await acknowledged();
    unwrap(await useCases.reportHandled(scout, { deliveryId }));

    await expect(readDelivery(scout, { deliveryId })).resolves.toEqual({
      isOk: false,
      error: { kind: 'DELIVERY_NOT_ACKNOWLEDGED', message: `Delivery ${deliveryId} is handled, not acknowledged: only an acknowledged delivery not yet handled is read again` },
    });
  });

  it('refuses a delivery not handled of the crew lease, naming its state', async () => {
    const deliveryId = await acknowledged();
    unwrap(await useCases.handOverDelivery(scout, { deliveryId, handOverNumber: 2, isOnceMore: true }));
    unwrap(await useCases.reportNotHandled(scout, { deliveryId }));

    await expect(readDelivery(scout, { deliveryId })).resolves.toEqual({
      isOk: false,
      error: { kind: 'DELIVERY_NOT_ACKNOWLEDGED', message: `Delivery ${deliveryId} is notHandled, not acknowledged: only an acknowledged delivery not yet handled is read again` },
    });
  });

  it('refuses a received delivery of the crew lease, naming its state', async () => {
    const deliveryId = await received();

    await expect(readDelivery(scout, { deliveryId })).resolves.toEqual({
      isOk: false,
      error: { kind: 'DELIVERY_NOT_ACKNOWLEDGED', message: `Delivery ${deliveryId} is received, not acknowledged: only an acknowledged delivery not yet handled is read again` },
    });
  });

  it('refuses a handed delivery of the crew lease, naming its state', async () => {
    const deliveryId = await handed();

    await expect(readDelivery(scout, { deliveryId })).resolves.toEqual({
      isOk: false,
      error: { kind: 'DELIVERY_NOT_ACKNOWLEDGED', message: `Delivery ${deliveryId} is handed, not acknowledged: only an acknowledged delivery not yet handled is read again` },
    });
  });

  it('refuses another ship acknowledged delivery as not found', async () => {
    const { deliveryId } = await sendFrom(argo, { shipId: lookoutId });
    unwrap(await useCases.receiveDeliveries(lookout, {}));
    unwrap(await useCases.acknowledgeDelivery(lookout, { deliveryId }));

    await expect(readDelivery(scout, { deliveryId })).resolves.toEqual({
      isOk: false,
      error: { kind: 'DELIVERY_NOT_FOUND', message: `Delivery ${deliveryId} does not exist` },
    });
  });

  it('refuses a pending delivery for the crew ship as not found: no lease holds it', async () => {
    const { deliveryId } = await sendFrom(argo, { shipId: scoutId });

    await expect(readDelivery(scout, { deliveryId })).resolves.toMatchObject({ isOk: false, error: { kind: 'DELIVERY_NOT_FOUND' } });
  });

  it('refuses what an ended lease acknowledged as not found to the next crew of the ship', async () => {
    const deliveryId = await acknowledged();
    await releaseScout();
    const nextCrew = crewAboard(core, { fleetId, shipId: scoutId });

    await expect(readDelivery(nextCrew, { deliveryId })).resolves.toMatchObject({ isOk: false, error: { kind: 'DELIVERY_NOT_FOUND' } });
    expect(stored(deliveryId)).toMatchObject({ state: 'acknowledged', claimedByLeaseId: scout.leaseId });
  });

  it('refuses a delivery the fleet does not have as not found', async () => {
    await expect(readDelivery(scout, { deliveryId: core.ids('delivery') })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'DELIVERY_NOT_FOUND' },
    });
  });

  it('refuses a crew whose lease ended', async () => {
    const deliveryId = await acknowledged();
    await releaseScout();

    await expect(readDelivery(scout, { deliveryId })).resolves.toMatchObject({ isOk: false, error: { kind: 'LEASE_ENDED' } });
  });
});
