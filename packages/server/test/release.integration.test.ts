import { createIdGenerator, idSchema, type DeliveryId, type FleetId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { listenForPendingDeliveries, type DeliveryListener } from '../src/adapters/prisma/delivery-notices.js';
import { createReceiverWakeups, type ReceiverWakeupHub } from '../src/adapters/prisma/receiver-wakeups.js';
import { createPrismaUnitOfWork, type PrismaTx } from '../src/adapters/prisma/unit-of-work.js';
import type { DeliveryNotice } from '../src/core/messaging/ports.js';
import { createReceiveDeliveries } from '../src/core/messaging/receive-deliveries.js';
import { createDeregister } from '../src/core/registry/deregister.js';
import { createReleaseShip } from '../src/core/registry/release-ship.js';
import type { Caller, Crew } from '../src/core/shared/caller.js';
import type { DomainError } from '../src/core/shared/errors.js';
import type { Result } from '../src/core/shared/result.js';
import type { Selector } from '../src/core/shared/selector.js';
import type { UnitOfWork } from '../src/core/shared/unit-of-work.js';
import { createUseCases, systemClock, type UseCases } from '../src/wiring.js';
import { FLEET_URL, OPERATOR, operatorCaller, secretIn } from './support/core-fixtures.js';
import { createMigratedDatabase } from './support/database.js';
import { everyRow, heldUnitOfWork } from './support/postgres-core.js';
import { unwrap } from './support/result.js';

// Releasing a ship and deregistering on a real Postgres, with the listener and
// the wake-ups the server runs: the lease, the secret and the crew token end
// together; what the lease held in flight goes back to its ship or its type,
// attempts kept, and the next crew receives it, and a receive of another ship
// of the type that waits gets it at once; a release racing a receive never
// leaves a delivery claimed by an ended lease; a waiting receive never holds a
// release up; a failed release stores nothing and wakes nobody.

const newId = createIdGenerator();
/** How long a receive waits on an empty inbox in these tests: short, so an empty receive costs little. */
const WAIT_MS = 2_000;
/** Time for a receive to start waiting before the test releases its ship. */
const SETTLE_MS = 300;
/** A release that finishes within this while a receive waits was not held up by it. */
const PROMPTLY_MS = 1_000;
/** The wait of a receive that must end early: it proves a wake-up, not a timeout. */
const LONG_WAIT_MS = 15_000;

let databaseUrl: string;
let prisma: PrismaClient;
let wakeups: ReceiverWakeupHub;
let listener: DeliveryListener;
/** Every notice the listener heard, in commit order. */
let notices: DeliveryNotice[];
let useCases: UseCases;
let fleetId: FleetId;
let argo: Caller;
let scout: Crewed;
let lookout: Crewed;

/** A ship a session crews: its crew, its crew token and the secret it registered with. */
interface Crewed {
  crew: Crew;
  crewToken: string;
  secret: string;
}

beforeEach(async () => {
  databaseUrl = await createMigratedDatabase();
  prisma = createPrismaClient(databaseUrl);
  wakeups = createReceiverWakeups();
  notices = [];
  listener = listenForPendingDeliveries({
    databaseUrl,
    onNotice: (notice) => {
      notices.push(notice);
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
  const { shipId: scoutId, prompt: scoutPrompt } = unwrap(
    await useCases.commissionShip(argo, { name: 'scout', type: 'reviewer' }),
  );
  scout = await register(scoutId, scoutPrompt);
  const { shipId: lookoutId, prompt: lookoutPrompt } = unwrap(
    await useCases.commissionShip(argo, { name: 'lookout', type: 'reviewer' }),
  );
  lookout = await register(lookoutId, lookoutPrompt);
});

afterEach(async () => {
  await listener.close();
  await prisma.$disconnect();
});

/** A session claims the ship with the secret its starting prompt holds. */
async function register(shipId: Crew['shipId'], prompt: string): Promise<Crewed> {
  const secret = secretIn(prompt);
  const { crewToken } = unwrap(await useCases.claimShip({ shipId, secret, location: { kind: 'CLOUD' } }));
  const crew = await useCases.authenticate.byCrewToken(crewToken);
  if (!crew) {
    throw new Error(`The crew token of ${shipId} authenticates no crew`);
  }
  return { crew, crewToken, secret };
}

/** A new starting prompt for the crew's ship, and a new session claiming it with its secret. */
async function nextCrewOf(crewed: Crewed): Promise<Crewed> {
  const { shipId } = crewed.crew;
  const { prompt } = unwrap(await useCases.getStartingPrompt(argo, { shipId }));
  return register(shipId, prompt);
}

const toShip = (crewed: Crewed): Selector => ({ kind: 'ship', shipId: crewed.crew.shipId });
const toReviewers: Selector = { kind: 'type', type: 'reviewer' };

/** Sends a plain-text message from argo and returns its delivery's id. */
async function sendTo(selector: Selector): Promise<DeliveryId> {
  const { messageId } = unwrap(
    await useCases.sendMessage(argo, {
      selector,
      payload: 'Review https://github.com/ThomasHendrickx/aeolus-fleet/pull/28',
      contentType: 'text/plain',
      idempotencyKey: `review-${newId('message')}`,
    }),
  );
  const { id } = await prisma.delivery.findFirstOrThrow({ where: { messageId } });
  return idSchema('delivery').parse(id);
}

/** The ids of the deliveries one receive returns. */
async function receive(crewed: Crewed): Promise<DeliveryId[]> {
  const { deliveries } = unwrap(await useCases.receiveDeliveries(crewed.crew, {}));
  return deliveries.map((delivery) => delivery.deliveryId);
}

function stored(deliveryId: DeliveryId) {
  return prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } });
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A receive by the crew that waits up to the given time on an empty inbox. */
function receiveWaiting(crewed: Crewed, waitMs: number) {
  return createReceiveDeliveries({ uow: createPrismaUnitOfWork(prisma), clock: systemClock, ids: newId, wakeups, waitMs })(
    crewed.crew,
    {},
  );
}

/**
 * Sends a message from argo to argo that commits, and waits for its notice.
 * Postgres hands one listener its notices in commit order, so once this one
 * arrives, every notice of a transaction that committed before it has too.
 */
async function probe(): Promise<void> {
  const deliveryId = await sendTo({ kind: 'ship', shipId: argo.shipId });
  await vi.waitFor(() => {
    expect(notices.map((notice) => notice.deliveryId)).toContain(deliveryId);
  });
}

/** The Prisma unit of work, failing right after the use case queued its first notice. */
function failingAfterItsNotice(): UnitOfWork<PrismaTx> {
  const uow = createPrismaUnitOfWork(prisma);
  return {
    run: (work) =>
      uow.run((tx) =>
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
  };
}

/** A way a lease ends cleanly, and the reason its LeaseRevoked records. */
interface Ending {
  name: string;
  reason: string;
  end: (crewed: Crewed) => Promise<Result<undefined, DomainError>>;
}

/** The two ways a lease ends cleanly: the operator releases the ship, or its crew deregisters. */
const endings: Ending[] = [
  { name: 'a release', reason: 'released', end: (crewed) => useCases.releaseShip(argo, { shipId: crewed.crew.shipId }) },
  { name: 'a deregister', reason: 'deregistered', end: (crewed) => useCases.deregister(crewed.crew) },
];

describe.each(endings)('$name on Postgres', ({ reason, end }) => {
  it('ends the lease, and with it the crew token, and invalidates the secret', async () => {
    unwrap(await end(scout));

    const lease = await prisma.lease.findUniqueOrThrow({ where: { id: scout.crew.leaseId } });
    expect(lease.endedAt).not.toBeNull();
    await expect(useCases.authenticate.byCrewToken(scout.crewToken)).resolves.toBeUndefined();
    await expect(
      useCases.claimShip({ shipId: scout.crew.shipId, secret: scout.secret, location: { kind: 'CLOUD' } }),
    ).resolves.toMatchObject({ isOk: false, error: { kind: 'WRONG_SHIP_ID_OR_SECRET' } });
    await expect(prisma.credential.count({ where: { shipId: scout.crew.shipId, invalidatedAt: null } })).resolves.toBe(0);
  });

  it('returns a direct delivery in flight to the ship, attempts kept, and the next crew receives it', async () => {
    const deliveryId = await sendTo(toShip(scout));
    expect(await receive(scout)).toEqual([deliveryId]);

    unwrap(await end(scout));

    await expect(stored(deliveryId)).resolves.toMatchObject({
      state: 'pending',
      claimedByShipId: null,
      claimedByLeaseId: null,
      attempts: 1,
    });
    const next = await nextCrewOf(scout);
    expect(await receive(next)).toEqual([deliveryId]);
    await expect(stored(deliveryId)).resolves.toMatchObject({ claimedByLeaseId: next.crew.leaseId, attempts: 2 });
  });

  it('returns a type delivery in flight to the queue of its type, and another ship of that type receives it', async () => {
    const deliveryId = await sendTo(toReviewers);
    expect(await receive(scout)).toEqual([deliveryId]);

    unwrap(await end(scout));

    await expect(stored(deliveryId)).resolves.toMatchObject({
      recipientType: 'reviewer',
      state: 'pending',
      claimedByShipId: null,
      attempts: 1,
    });
    expect(await receive(lookout)).toEqual([deliveryId]);
    await expect(stored(deliveryId)).resolves.toMatchObject({ claimedByLeaseId: lookout.crew.leaseId, attempts: 2 });
  });

  it("returns only that lease's deliveries in flight: an acknowledged one and another crew's stay as they are", async () => {
    const acknowledged = await sendTo(toShip(scout));
    expect(await receive(scout)).toEqual([acknowledged]);
    unwrap(await useCases.acknowledgeDelivery(scout.crew, { deliveryId: acknowledged }));
    const lookouts = await sendTo(toShip(lookout));
    expect(await receive(lookout)).toEqual([lookouts]);

    unwrap(await end(scout));

    await expect(stored(acknowledged)).resolves.toMatchObject({ state: 'acknowledged', claimedByLeaseId: scout.crew.leaseId });
    await expect(stored(lookouts)).resolves.toMatchObject({ state: 'delivered', claimedByLeaseId: lookout.crew.leaseId });
  });

  it('writes CredentialRevoked, LeaseRevoked and one DeliveryReturned per returned delivery', async () => {
    const first = await sendTo(toShip(scout));
    const second = await sendTo(toReviewers);
    const { deliveries } = unwrap(await useCases.receiveDeliveries(scout.crew, { max: 2 }));
    expect(deliveries.map((delivery) => delivery.deliveryId)).toEqual([first, second]);
    const { shipId, leaseId } = scout.crew;
    const credential = await prisma.credential.findFirstOrThrow({ where: { shipId, invalidatedAt: null } });
    const since = await prisma.event.count();

    unwrap(await end(scout));

    const events = await prisma.event.findMany({ orderBy: { id: 'asc' }, skip: since });
    expect(events.map((event) => [event.type, event.shipId, event.deliveryId, event.details])).toEqual([
      ['CredentialRevoked', shipId, null, { credentialId: credential.id }],
      ['LeaseRevoked', shipId, null, { leaseId, reason, returnedDeliveries: 2 }],
      ['DeliveryReturned', shipId, first, { leaseId, attempts: 1 }],
      ['DeliveryReturned', shipId, second, { leaseId, attempts: 1 }],
    ]);
  });

  it('wakes a receive of another ship of the type waiting on an empty inbox: it gets the returned type delivery at once', async () => {
    const deliveryId = await sendTo(toReviewers);
    expect(await receive(scout)).toEqual([deliveryId]);
    const startedAt = performance.now();
    const receiving = receiveWaiting(lookout, LONG_WAIT_MS);
    await pause(SETTLE_MS);

    unwrap(await end(scout));

    expect(unwrap(await receiving).deliveries.map((delivery) => delivery.deliveryId)).toEqual([deliveryId]);
    expect(performance.now() - startedAt).toBeLessThan(LONG_WAIT_MS / 2);
  });

  it('completes promptly while a receive of the crew waits, and the receive answers without deliveries', async () => {
    const receiving = useCases.receiveDeliveries(scout.crew, {});
    await pause(SETTLE_MS);

    const startedAt = performance.now();
    unwrap(await end(scout));
    const tookMs = performance.now() - startedAt;

    expect(tookMs).toBeLessThan(PROMPTLY_MS);
    await expect(receiving).resolves.toEqual({ isOk: true, value: { deliveries: [] } });
  });
});

describe('a release that fails', () => {
  it('stores nothing: the crew keeps the ship, its secret and its delivery', async () => {
    await sendTo(toShip(scout));
    expect(await receive(scout)).toHaveLength(1);
    const before = await everyRow(prisma);
    const failingRelease = createReleaseShip({
      uow: {
        run: (work) =>
          createPrismaUnitOfWork(prisma).run((tx) =>
            work({ ...tx, events: { append: () => Promise.reject(new Error('disk full')) } }),
          ),
      },
      clock: systemClock,
      ids: newId,
    });

    await expect(failingRelease(argo, { shipId: scout.crew.shipId })).rejects.toThrow('disk full');

    await expect(everyRow(prisma)).resolves.toBe(before);
    await expect(useCases.authenticate.byCrewToken(scout.crewToken)).resolves.toMatchObject({
      leaseId: scout.crew.leaseId,
    });
  });

  it('after it queued the notice of a returned delivery, stores nothing and wakes nobody', async () => {
    const deliveryId = await sendTo(toReviewers);
    expect(await receive(scout)).toEqual([deliveryId]);
    await probe();
    notices.length = 0;
    const before = await everyRow(prisma);
    const failingRelease = createReleaseShip({ uow: failingAfterItsNotice(), clock: systemClock, ids: newId });

    await expect(failingRelease(argo, { shipId: scout.crew.shipId })).rejects.toThrow('disk full');

    await expect(everyRow(prisma)).resolves.toBe(before);
    await probe();
    expect(notices.map((notice) => notice.recipient)).toEqual([{ kind: 'ship', shipId: argo.shipId }]);
  });
});

describe('a deregister that fails', () => {
  it('stores nothing: the crew keeps the ship, its secret and its delivery', async () => {
    await sendTo(toShip(scout));
    expect(await receive(scout)).toHaveLength(1);
    const before = await everyRow(prisma);
    const failingDeregister = createDeregister({
      uow: {
        run: (work) =>
          createPrismaUnitOfWork(prisma).run((tx) =>
            work({ ...tx, events: { append: () => Promise.reject(new Error('disk full')) } }),
          ),
      },
      clock: systemClock,
      ids: newId,
    });

    await expect(failingDeregister(scout.crew)).rejects.toThrow('disk full');

    await expect(everyRow(prisma)).resolves.toBe(before);
  });

  it('after it queued the notice of a returned delivery, stores nothing and wakes nobody', async () => {
    const deliveryId = await sendTo(toReviewers);
    expect(await receive(scout)).toEqual([deliveryId]);
    await probe();
    notices.length = 0;
    const before = await everyRow(prisma);
    const failingDeregister = createDeregister({ uow: failingAfterItsNotice(), clock: systemClock, ids: newId });

    await expect(failingDeregister(scout.crew)).rejects.toThrow('disk full');

    await expect(everyRow(prisma)).resolves.toBe(before);
    await probe();
    expect(notices.map((notice) => notice.recipient)).toEqual([{ kind: 'ship', shipId: argo.shipId }]);
  });
});

describe('a release racing a receive', () => {
  function receiveWith(uow: UnitOfWork<PrismaTx>) {
    return createReceiveDeliveries({ uow, clock: systemClock, ids: newId, wakeups, waitMs: WAIT_MS });
  }

  it('waits for a receive holding the lease, then returns what it claimed: nothing stays claimed by the ended lease', async () => {
    const deliveryId = await sendTo(toShip(scout));
    const { uow, reached } = heldUnitOfWork(prisma, (tx, hold) => ({
      ...tx,
      deliveries: {
        ...tx.deliveries,
        update: async (delivery) => {
          await tx.deliveries.update(delivery);
          await hold();
        },
      },
    }));

    const receiving = receiveWith(uow)(scout.crew, {});
    await reached;
    const releasing = useCases.releaseShip(argo, { shipId: scout.crew.shipId });
    const received = unwrap(await receiving);
    unwrap(await releasing);

    expect(received.deliveries.map((delivery) => delivery.deliveryId)).toEqual([deliveryId]);
    await expect(stored(deliveryId)).resolves.toMatchObject({
      state: 'pending',
      claimedByShipId: null,
      claimedByLeaseId: null,
      attempts: 1,
    });
    await expect(prisma.event.count({ where: { type: 'DeliveryReturned', deliveryId } })).resolves.toBe(1);
  });

  it('makes a receive that starts while it holds the lease wait, then refuses it: it claims nothing', async () => {
    const deliveryId = await sendTo(toShip(scout));
    const { uow, reached } = heldUnitOfWork(prisma, (tx, hold) => ({
      ...tx,
      inFlightDeliveries: {
        returnToPending: async (fleet, leaseId) => {
          const returned = await tx.inFlightDeliveries.returnToPending(fleet, leaseId);
          await hold();
          return returned;
        },
      },
    }));
    const release = createReleaseShip({ uow, clock: systemClock, ids: newId });

    const releasing = release(argo, { shipId: scout.crew.shipId });
    await reached;
    const receiving = useCases.receiveDeliveries(scout.crew, {});
    unwrap(await releasing);

    await expect(receiving).resolves.toMatchObject({ isOk: false, error: { kind: 'LEASE_ENDED' } });
    await expect(stored(deliveryId)).resolves.toMatchObject({ state: 'pending', claimedByLeaseId: null, attempts: 0 });
  });

  it('never leaves a delivery claimed by an ended lease, however many receives race it', async () => {
    const sent: DeliveryId[] = [];
    for (let count = 0; count < 12; count += 1) {
      sent.push(await sendTo(toReviewers));
    }

    const receives = [scout, scout, scout, lookout].map((crewed) =>
      useCases.receiveDeliveries(crewed.crew, { max: 3 }),
    );
    unwrap(await useCases.releaseShip(argo, { shipId: scout.crew.shipId }));
    await Promise.all(receives);

    await expect(
      prisma.delivery.count({ where: { claimedByLeaseId: scout.crew.leaseId, state: 'delivered' } }),
    ).resolves.toBe(0);
    const returned = await prisma.delivery.count({ where: { fleetId, id: { in: sent }, state: 'pending', attempts: { gt: 0 } } });
    await expect(prisma.event.count({ where: { type: 'DeliveryReturned' } })).resolves.toBe(returned);
  });
});
