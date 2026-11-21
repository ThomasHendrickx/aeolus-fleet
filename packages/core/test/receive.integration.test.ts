import { createIdGenerator, idSchema, type DeliveryId, type FleetId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import type { PrismaTx } from '../src/adapters/prisma/unit-of-work.js';
import { createReceiveDeliveries } from '../src/domain/messaging/receive-deliveries.js';
import type { ShipCaller, Crew } from '../src/domain/shared/caller.js';
import type { Selector } from '../src/domain/shared/selector.js';
import type { UnitOfWork } from '../src/domain/shared/unit-of-work.js';
import { createUseCases, systemClock, type UseCases } from '../src/wiring.js';
import { operatorCaller, modelOf, secretOf } from './support/core-fixtures.js';
import { createMigratedDatabase } from '../src/testing/database.js';
import { heldUnitOfWork, racingUnitOfWork } from './support/postgres-core.js';
import { unwrap } from '../src/testing/result.js';
import { newKey } from '../src/testing/keys.js';
import { withOperatorLogin } from './support/operator-login.js';
import { unsealedFleetsOnly } from './support/sealing.js';

// Receiving and acknowledging on a real Postgres: what a claim stores, the
// order and the limit of a receive, the fifth claim, that concurrent receivers
// never share a delivery, that a receive on an empty inbox answers at once, and
// that a lease ending while its crew receives gets back what it claimed.

const newId = createIdGenerator();
/** Well under any wait a call once had: an answer this soon did not wait. */
const AT_ONCE_MS = 1_000;

let databaseUrl: string;
let prisma: PrismaClient;
let useCases: UseCases;
let fleetId: FleetId;
let argo: ShipCaller;
let scout: Crew;
let lookout: Crew;

beforeEach(async () => {
  databaseUrl = await createMigratedDatabase();
  prisma = createPrismaClient(databaseUrl);
  useCases = createUseCases({ prisma, clock: systemClock });
  const fleet = unwrap(await withOperatorLogin(prisma, useCases.initialiseFleet({ name: 'home fleet' })));
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  scout = await crewedReviewer('scout');
  lookout = await crewedReviewer('lookout');
});

afterEach(async () => {
  await prisma.$disconnect();
});

/** A reviewer commissioned by argo and claimed with its secret: its crew, as its crew token makes it. */
async function crewedReviewer(name: string): Promise<Crew> {
  const { shipId, secret } = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name, type: 'reviewer' }));
  const { crewToken } = unwrap(
    await useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'CLOUD' }, harness: 'claude-code' }),
  );
  return unwrap(await useCases.authenticate.byCrewToken(crewToken));
}

const toShip = (crew: Crew): Selector => ({ kind: 'ship', shipId: crew.shipId });
const toReviewers: Selector = { kind: 'type', type: 'reviewer' };

/** Sends a plain-text message from argo and returns its delivery's id. */
async function sendTo(selector: Selector, options: { isForced?: boolean } = {}): Promise<DeliveryId> {
  const { messageId } = unwrap(
    await useCases.sendMessage(argo, {
      selector,
      payload: 'Review https://github.com/ThomasHendrickx/aeolus-fleet/pull/25',
      contentType: 'text/plain',
      idempotencyKey: `review-${newId('message')}`,
      ...options,
    }),
  );
  const { id } = await prisma.delivery.findFirstOrThrow({ where: { messageId } });
  return idSchema('delivery').parse(id);
}

/** The ids of the deliveries one receive returns. */
async function receive(crew: Crew, max?: number): Promise<DeliveryId[]> {
  const { deliveries } = unwrap(await useCases.receiveDeliveries(crew, max === undefined ? {} : { max }));
  return deliveries.map((delivery) => delivery.deliveryId);
}

function receiveWith(uow: UnitOfWork<PrismaTx>) {
  return createReceiveDeliveries({ sealing: unsealedFleetsOnly, uow, clock: systemClock, ids: newId });
}

/** The operator releases the crew's ship: its lease ends, and what it held in flight returns to pending. */
async function endLeaseOf(crew: Crew): Promise<void> {
  unwrap(await useCases.releaseShip(argo, { shipId: crew.shipId }));
}

function stored(deliveryId: DeliveryId) {
  return prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } });
}

describe('receiving on Postgres', () => {
  it("hands a delivery over at once: handed to the ship and its crew's lease, one attempt, DeliveryHanded", async () => {
    const deliveryId = await sendTo(toShip(scout));
    const message = await prisma.message.findFirstOrThrow();

    const received = unwrap(await useCases.receiveDeliveries(scout, {}));

    expect(received).toEqual({
      deliveries: [
        {
          deliveryId,
          messageId: message.id,
          senderShipId: argo.shipId,
          senderLeaseId: null,
          senderName: 'argo',
          senderType: 'operator',
          senderStatus: 'crewed',
          recipient: { kind: 'ship', shipId: scout.shipId },
          payload: message.payload,
          contentType: 'text/plain',
          model: null,
          inReplyTo: null,
          sentAt: message.createdAt,
          attempts: 1,
          isForced: false,
          meetingId: null,
          scheduleId: null,
          sendTime: null,
        },
      ],
    });
    await expect(stored(deliveryId)).resolves.toMatchObject({
      state: 'handed',
      claimedByShipId: scout.shipId,
      claimedByLeaseId: scout.leaseId,
      attempts: 1,
    });
    await expect(prisma.event.findMany({ where: { type: 'DeliveryHanded' } })).resolves.toEqual([
      expect.objectContaining({
        fleetId,
        actorShipId: scout.shipId,
        shipId: scout.shipId,
        messageId: message.id,
        deliveryId,
        details: { leaseId: scout.leaseId, attempts: 1 },
      }),
    ]);
  });

  it("hands over the sender's name as it is now: renamed after the send, by its new name, with its type", async () => {
    const { messageId } = unwrap(
      await useCases.sendMessage(lookout, { ...modelOf(lookout),
        selector: toShip(scout),
        payload: 'Can you take https://github.com/ThomasHendrickx/aeolus-fleet/pull/25?',
        idempotencyKey: 'ask-scout',
      }),
    );
    await prisma.ship.update({ where: { id: lookout.shipId }, data: { name: 'watch' } });

    const { deliveries } = unwrap(await useCases.receiveDeliveries(scout, {}));

    expect(deliveries).toEqual([
      expect.objectContaining({ messageId, senderShipId: lookout.shipId, senderName: 'watch', senderType: 'reviewer' }),
    ]);
  });

  it("takes up to max: the crew's own in flight first, then pending ones for its ship or its type, oldest first", async () => {
    const forType = await sendTo(toReviewers);
    const first = await sendTo(toShip(scout));
    const second = await sendTo(toShip(scout));
    const forLookout = await sendTo(toShip(lookout));
    expect(await receive(scout)).toEqual([forType]);

    expect(await receive(scout, 3)).toEqual([forType, first, second]);
    await expect(stored(forLookout)).resolves.toMatchObject({ state: 'pending', attempts: 0 });
    await expect(stored(forType)).resolves.toMatchObject({ attempts: 2 });
  });

  it('hands a delivery whose receive reply was lost to the same crew again, as another attempt', async () => {
    const deliveryId = await sendTo(toShip(scout));
    await receive(scout);

    expect(await receive(scout)).toEqual([deliveryId]);
    await expect(stored(deliveryId)).resolves.toMatchObject({ claimedByLeaseId: scout.leaseId, attempts: 2 });
  });

  it('makes a delivery undeliverable at its fifth attempt, and hands out the next one in its place', async () => {
    const poison = await sendTo(toShip(scout));
    const next = await sendTo(toShip(scout));
    for (let claim = 1; claim <= 4; claim += 1) {
      expect(await receive(scout)).toEqual([poison]);
    }

    expect(await receive(scout)).toEqual([next]);
    await expect(stored(poison)).resolves.toMatchObject({
      state: 'undeliverable',
      claimedByShipId: null,
      claimedByLeaseId: null,
      attempts: 5,
    });
    await expect(prisma.event.findMany({ where: { type: 'DeliveryUndeliverable' } })).resolves.toEqual([
      expect.objectContaining({ deliveryId: poison, actorShipId: scout.shipId, details: { leaseId: scout.leaseId, attempts: 5 } }),
    ]);
  });

  it('refuses a crew whose lease has ended, and claims nothing', async () => {
    const deliveryId = await sendTo(toShip(scout));
    await endLeaseOf(scout);

    await expect(useCases.receiveDeliveries(scout, {})).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'LEASE_ENDED' },
    });
    await expect(stored(deliveryId)).resolves.toMatchObject({ state: 'pending', attempts: 0 });
  });
});

describe('concurrent receivers of one type', () => {
  it('never get the same delivery, even while both hold their claims open', async () => {
    const sent = [await sendTo(toReviewers), await sendTo(toReviewers), await sendTo(toReviewers), await sendTo(toReviewers)];
    const racing = receiveWith(
      racingUnitOfWork({ prisma, transactions: 2 }, (tx, allArrived) => ({
        ...tx,
        deliveries: {
          ...tx.deliveries,
          findClaimableForUpdate: async (query) => {
            const claimable = await tx.deliveries.findClaimableForUpdate(query);
            await allArrived();
            return claimable;
          },
        },
      })),
    );

    const [byScout, byLookout] = await Promise.all([racing(scout, { max: 2 }), racing(lookout, { max: 2 })]);

    const scoutGot = unwrap(byScout).deliveries.map((delivery) => delivery.deliveryId);
    const lookoutGot = unwrap(byLookout).deliveries.map((delivery) => delivery.deliveryId);
    expect(scoutGot).toHaveLength(2);
    expect(lookoutGot).toHaveLength(2);
    expect([...scoutGot, ...lookoutGot].sort()).toEqual([...sent].sort());
  });

  it('share many deliveries out between many crews receiving at once, each delivery exactly once', async () => {
    const crews = [scout, lookout];
    for (const name of ['sentry', 'pilot', 'bosun', 'purser', 'helmsman', 'navigator']) {
      crews.push(await crewedReviewer(name));
    }
    const sent: DeliveryId[] = [];
    for (let count = 0; count < 24; count += 1) {
      sent.push(await sendTo(toReviewers));
    }

    const results = await Promise.all(crews.map((crew) => receive(crew, 3)));

    expect(results.flat().sort()).toEqual([...sent].sort());
    await expect(prisma.delivery.count({ where: { state: 'handed', attempts: 1 } })).resolves.toBe(24);
  });
});

describe('a receive on an empty inbox (decision 0072)', () => {
  it('answers at once with nothing: a receive never waits', async () => {
    const startedAt = performance.now();

    await expect(useCases.receiveDeliveries(scout, {})).resolves.toEqual({ isOk: true, value: { deliveries: [] } });
    expect(performance.now() - startedAt).toBeLessThan(AT_ONCE_MS);
  });
});

describe('a lease that ends while its crew receives', () => {
  it('gets back what the receive claimed: nothing stays claimed by an ended lease', async () => {
    const deliveryId = await sendTo(toShip(scout));
    const { uow, reached } = heldUnitOfWork(prisma, (tx, hold) => ({
      ...tx,
      leases: {
        ...tx.leases,
        findOpenByIdForShare: async (fleet, leaseId) => {
          const lease = await tx.leases.findOpenByIdForShare(fleet, leaseId);
          await hold();
          return lease;
        },
      },
    }));

    const receiving = receiveWith(uow)(scout, {});
    await reached;
    const ending = endLeaseOf(scout);
    const received = unwrap(await receiving);
    await ending;

    expect(received.deliveries.map((delivery) => delivery.deliveryId)).toEqual([deliveryId]);
    await expect(stored(deliveryId)).resolves.toMatchObject({
      state: 'pending',
      claimedByShipId: null,
      claimedByLeaseId: null,
      attempts: 1,
    });
  });
});

describe('acknowledging on Postgres', () => {
  it('moves the delivery to acknowledged and writes DeliveryAcknowledged; a second ack is OK and writes nothing', async () => {
    const deliveryId = await sendTo(toShip(scout));
    await receive(scout);

    unwrap(await useCases.acknowledgeDelivery(scout, { deliveryId }));
    unwrap(await useCases.acknowledgeDelivery(scout, { deliveryId }));

    await expect(stored(deliveryId)).resolves.toMatchObject({
      state: 'acknowledged',
      claimedByShipId: scout.shipId,
      claimedByLeaseId: scout.leaseId,
    });
    await expect(prisma.event.findMany({ where: { type: 'DeliveryAcknowledged' } })).resolves.toEqual([
      expect.objectContaining({ deliveryId, actorShipId: scout.shipId, details: { leaseId: scout.leaseId } }),
    ]);
  });

  it('refuses a delivery another ship holds, which stays with it', async () => {
    const deliveryId = await sendTo(toReviewers);
    await receive(lookout);

    await expect(useCases.acknowledgeDelivery(scout, { deliveryId })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'DELIVERY_HELD_BY_ANOTHER_SHIP' },
    });
    await expect(stored(deliveryId)).resolves.toMatchObject({ state: 'handed', claimedByShipId: lookout.shipId });
  });
});

describe('checking the inbox on Postgres', () => {
  it("counts what the crew's next receive would hand it: its own in flight, pending to its ship and its type, and claims none", async () => {
    const inFlight = await sendTo(toShip(scout));
    await receive(scout);
    const pending = await sendTo(toShip(scout));
    const queued = await sendTo(toReviewers);
    await sendTo(toShip(lookout));

    await expect(useCases.checkInbox(scout)).resolves.toEqual({ isOk: true, value: { waiting: 3, forced: 0 } });
    await expect(stored(pending)).resolves.toMatchObject({ state: 'pending', attempts: 0 });
    await expect(stored(queued)).resolves.toMatchObject({ state: 'pending', attempts: 0 });
    await expect(stored(inFlight)).resolves.toMatchObject({ state: 'handed', attempts: 1 });
  });
});

describe('forced deliveries on Postgres (decision 0040)', () => {
  it("come first: before the crew's own in flight and older pending ones, oldest forced first", async () => {
    const inFlight = await sendTo(toShip(scout));
    expect(await receive(scout)).toEqual([inFlight]);
    const older = await sendTo(toShip(scout));
    const firstForced = await sendTo(toShip(scout), { isForced: true });
    const secondForced = await sendTo(toReviewers, { isForced: true });

    expect(await receive(scout, 4)).toEqual([firstForced, secondForced, inFlight, older]);
  });

  it('store that they were forced, with MessageAccepted saying so', async () => {
    const forced = await sendTo(toShip(scout), { isForced: true });
    const plain = await sendTo(toShip(scout));

    await expect(stored(forced)).resolves.toMatchObject({ isForced: true });
    await expect(stored(plain)).resolves.toMatchObject({ isForced: false });
    await expect(prisma.event.findFirstOrThrow({ where: { type: 'MessageAccepted', deliveryId: forced } })).resolves.toMatchObject({
      details: { forced: true },
    });
  });

  it('are counted apart in the inbox check until handed, and say they were forced when received', async () => {
    await sendTo(toShip(scout), { isForced: true });
    await sendTo(toReviewers, { isForced: true });
    await sendTo(toShip(scout));
    await expect(useCases.checkInbox(scout)).resolves.toEqual({ isOk: true, value: { waiting: 3, forced: 2 } });

    const received = unwrap(await useCases.receiveDeliveries(scout, { max: 3 })).deliveries;

    expect(received.map((delivery) => delivery.isForced)).toEqual([true, true, false]);
    await expect(useCases.checkInbox(scout)).resolves.toEqual({ isOk: true, value: { waiting: 3, forced: 0 } });
  });

  it('go to concurrent receivers of one type before any older plain delivery, each exactly once, while both hold their claims open', async () => {
    const plain = [await sendTo(toReviewers), await sendTo(toReviewers)];
    const forced = [await sendTo(toReviewers, { isForced: true }), await sendTo(toReviewers, { isForced: true })];
    const racing = receiveWith(
      racingUnitOfWork({ prisma, transactions: 2 }, (tx, allArrived) => ({
        ...tx,
        deliveries: {
          ...tx.deliveries,
          findClaimableForUpdate: async (query) => {
            const claimable = await tx.deliveries.findClaimableForUpdate(query);
            await allArrived();
            return claimable;
          },
        },
      })),
    );

    const [byScout, byLookout] = await Promise.all([racing(scout, { max: 1 }), racing(lookout, { max: 1 })]);

    const got = [...unwrap(byScout).deliveries, ...unwrap(byLookout).deliveries].map((delivery) => delivery.deliveryId);
    expect(got.sort()).toEqual([...forced].sort());
    await expect(prisma.delivery.findMany({ where: { id: { in: plain } }, select: { state: true } })).resolves.toEqual([
      { state: 'pending' },
      { state: 'pending' },
    ]);
    await expect(prisma.delivery.count({ where: { id: { in: forced }, state: 'handed' } })).resolves.toBe(2);
  });
});
