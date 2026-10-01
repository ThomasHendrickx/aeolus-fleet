import { createIdGenerator, idSchema, type DeliveryId, type FleetId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sha256Hasher } from '../src/adapters/crypto/secrets.js';
import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { listenForPendingDeliveries, type DeliveryListener } from '../src/adapters/prisma/delivery-notices.js';
import { createReceiverWakeups, type ReceiverWakeupHub } from '../src/adapters/prisma/receiver-wakeups.js';
import { createPrismaUnitOfWork, type PrismaTx } from '../src/adapters/prisma/unit-of-work.js';
import { createReceiveDeliveries } from '../src/core/messaging/receive-deliveries.js';
import { createSendMessage } from '../src/core/messaging/send-message.js';
import type { Caller, Crew } from '../src/core/shared/caller.js';
import type { Selector } from '../src/core/shared/selector.js';
import type { UnitOfWork } from '../src/core/shared/unit-of-work.js';
import { createUseCases, systemClock, type UseCases } from '../src/wiring.js';
import { FLEET_URL, OPERATOR, operatorCaller, secretIn } from './support/core-fixtures.js';
import { createMigratedDatabase } from './support/database.js';
import { heldUnitOfWork, racingUnitOfWork } from './support/postgres-core.js';
import { unwrap } from './support/result.js';

// Receiving and acknowledging on a real Postgres, with the listener and the
// wake-ups the server runs: what a claim stores, the order and the limit of a
// receive, the fifth claim, that concurrent receivers never share a delivery,
// that a waiting receive wakes when a send commits and never for one that rolls
// back, and that a lease ending while its crew receives gets back what it claimed.

const newId = createIdGenerator();
/** How long a receive waits on an empty inbox in these tests: short, so an empty receive costs little. */
const WAIT_MS = 2_000;
/** The wait of a receive that must end early: it proves a wake-up, not a timeout. */
const LONG_WAIT_MS = 15_000;
/** Time for a receive to start waiting before the test sends. */
const SETTLE_MS = 300;

let databaseUrl: string;
let prisma: PrismaClient;
let wakeups: ReceiverWakeupHub;
let listener: DeliveryListener;
let useCases: UseCases;
let fleetId: FleetId;
let argo: Caller;
let scout: Crew;
let lookout: Crew;

beforeEach(async () => {
  databaseUrl = await createMigratedDatabase();
  prisma = createPrismaClient(databaseUrl);
  wakeups = createReceiverWakeups();
  listener = listenForPendingDeliveries({
    databaseUrl,
    onNotice: (notice) => {
      wakeups.deliveryPending(notice);
    },
    onListening: () => {
      wakeups.wakeAll();
    },
  });
  await listener.listening;
  useCases = createUseCases({ prisma, clock: systemClock, fleetUrl: FLEET_URL, wakeups, receiveWaitMs: WAIT_MS });
  const fleet = unwrap(await useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR }));
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  scout = await crewedReviewer('scout');
  lookout = await crewedReviewer('lookout');
});

afterEach(async () => {
  await listener.close();
  await prisma.$disconnect();
});

/** A reviewer commissioned by argo and claimed with its secret: its crew, as its crew token makes it. */
async function crewedReviewer(name: string): Promise<Crew> {
  const { shipId, prompt } = unwrap(await useCases.commissionShip(argo, { name, type: 'reviewer' }));
  const { crewToken } = unwrap(
    await useCases.claimShip({ shipId, secret: secretIn(prompt), location: { kind: 'CLOUD' } }),
  );
  return unwrap(await useCases.authenticate.byCrewToken(crewToken));
}

const toShip = (crew: Crew): Selector => ({ kind: 'ship', shipId: crew.shipId });
const toReviewers: Selector = { kind: 'type', type: 'reviewer' };

/** Sends a plain-text message from argo and returns its delivery's id. */
async function sendTo(selector: Selector): Promise<DeliveryId> {
  const { messageId } = unwrap(
    await useCases.sendMessage(argo, {
      selector,
      payload: 'Review https://github.com/ThomasHendrickx/aeolus-fleet/pull/25',
      contentType: 'text/plain',
      idempotencyKey: `review-${newId('message')}`,
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

function receiveWith(uow: UnitOfWork<PrismaTx>, waitMs = WAIT_MS) {
  return createReceiveDeliveries({ uow, clock: systemClock, ids: newId, wakeups, waitMs });
}

/** The operator releases the crew's ship: its lease ends, and what it held in flight returns to pending. */
async function endLeaseOf(crew: Crew): Promise<void> {
  unwrap(await useCases.releaseShip(argo, { shipId: crew.shipId }));
}

function stored(deliveryId: DeliveryId) {
  return prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } });
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('receiving on Postgres', () => {
  it("claims a delivery: in flight, claimed by the ship and its crew's lease, one attempt, DeliveryClaimed", async () => {
    const deliveryId = await sendTo(toShip(scout));
    const message = await prisma.message.findFirstOrThrow();

    const received = unwrap(await useCases.receiveDeliveries(scout, {}));

    expect(received).toEqual({
      deliveries: [
        {
          deliveryId,
          messageId: message.id,
          senderShipId: argo.shipId,
          senderName: 'argo',
          senderType: 'operator',
          recipient: { kind: 'ship', shipId: scout.shipId },
          payload: message.payload,
          contentType: 'text/plain',
          inReplyTo: null,
          sentAt: message.createdAt,
          attempts: 1,
        },
      ],
    });
    await expect(stored(deliveryId)).resolves.toMatchObject({
      state: 'delivered',
      claimedByShipId: scout.shipId,
      claimedByLeaseId: scout.leaseId,
      attempts: 1,
    });
    await expect(prisma.event.findMany({ where: { type: 'DeliveryClaimed' } })).resolves.toEqual([
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
      await useCases.sendMessage(lookout, {
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

  it('returns a delivery whose receive reply was lost to the same crew, as another claim', async () => {
    const deliveryId = await sendTo(toShip(scout));
    await receive(scout);

    expect(await receive(scout)).toEqual([deliveryId]);
    await expect(stored(deliveryId)).resolves.toMatchObject({ claimedByLeaseId: scout.leaseId, attempts: 2 });
  });

  it('makes a delivery undeliverable at its fifth claim, and hands out the next one in its place', async () => {
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
    await expect(prisma.delivery.count({ where: { state: 'delivered', attempts: 1 } })).resolves.toBe(24);
  });
});

describe('a receive waiting on an empty inbox', () => {
  it('returns as soon as a send to its ship commits', async () => {
    const startedAt = performance.now();
    const receiving = receiveWith(createPrismaUnitOfWork(prisma), LONG_WAIT_MS)(scout, {});
    await pause(SETTLE_MS);

    const deliveryId = await sendTo(toShip(scout));

    expect(unwrap(await receiving).deliveries.map((delivery) => delivery.deliveryId)).toEqual([deliveryId]);
    expect(performance.now() - startedAt).toBeLessThan(LONG_WAIT_MS / 2);
  });

  it('returns as soon as a send to its type commits', async () => {
    const startedAt = performance.now();
    const receiving = receiveWith(createPrismaUnitOfWork(prisma), LONG_WAIT_MS)(scout, {});
    await pause(SETTLE_MS);

    const deliveryId = await sendTo(toReviewers);

    expect(unwrap(await receiving).deliveries.map((delivery) => delivery.deliveryId)).toEqual([deliveryId]);
    expect(performance.now() - startedAt).toBeLessThan(LONG_WAIT_MS / 2);
  });

  it('never returns for a send that rolls back: it waits out its wait, empty', async () => {
    const failingSend = createSendMessage({
      uow: {
        run: (work) =>
          createPrismaUnitOfWork(prisma).run((tx) =>
            work({
              ...tx,
              notifier: {
                deliveryPending: async (notice) => {
                  await tx.notifier.deliveryPending(notice);
                  throw new Error('disk full');
                },
              },
            }),
          ),
      },
      clock: systemClock,
      ids: newId,
      hasher: sha256Hasher,
    });
    const startedAt = performance.now();
    const receiving = useCases.receiveDeliveries(scout, {});
    await pause(SETTLE_MS);

    await expect(
      failingSend(argo, {
        selector: toShip(scout),
        payload: 'never stored',
        contentType: 'text/plain',
        idempotencyKey: 'rolled-back',
      }),
    ).rejects.toThrow('disk full');

    await expect(receiving).resolves.toEqual({ isOk: true, value: { deliveries: [] } });
    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(WAIT_MS - 50);
    await expect(prisma.delivery.count()).resolves.toBe(0);
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
    await expect(stored(deliveryId)).resolves.toMatchObject({ state: 'delivered', claimedByShipId: lookout.shipId });
  });
});

describe('checking the inbox on Postgres', () => {
  it("counts what the crew's next receive would hand it: its own in flight, pending to its ship and its type, and claims none", async () => {
    const inFlight = await sendTo(toShip(scout));
    await receive(scout);
    const pending = await sendTo(toShip(scout));
    const queued = await sendTo(toReviewers);
    await sendTo(toShip(lookout));

    await expect(useCases.checkInbox(scout, {})).resolves.toEqual({ isOk: true, value: { waiting: 3 } });
    await expect(stored(pending)).resolves.toMatchObject({ state: 'pending', attempts: 0 });
    await expect(stored(queued)).resolves.toMatchObject({ state: 'pending', attempts: 0 });
    await expect(stored(inFlight)).resolves.toMatchObject({ state: 'delivered', attempts: 1 });
  });

  it('waits while nothing waits, and answers as soon as a delivery is sent', async () => {
    const startedAt = Date.now();
    const checking = useCases.checkInbox(scout, { waitSeconds: 15 });
    await pause(SETTLE_MS);

    await sendTo(toReviewers);

    await expect(checking).resolves.toEqual({ isOk: true, value: { waiting: 1 } });
    expect(Date.now() - startedAt).toBeLessThan(LONG_WAIT_MS);
  });
});
