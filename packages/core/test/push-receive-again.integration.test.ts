import { createIdGenerator, idSchema, type DeliveryId, type FleetId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createReceiverWakeups } from '../src/adapters/prisma/receiver-wakeups.js';
import { createPrismaUnitOfWork } from '../src/adapters/prisma/unit-of-work.js';
import { createPushReceiveDeliveries } from '../src/domain/messaging/push-receive-deliveries.js';
import type { Crew, ShipCaller } from '../src/domain/shared/caller.js';
import type { Selector } from '../src/domain/shared/selector.js';
import { createMigratedDatabase } from '../src/testing/database.js';
import { newKey } from '../src/testing/keys.js';
import { unwrap } from '../src/testing/result.js';
import { createUseCases, systemClock, type UseCases } from '../src/wiring.js';
import { operatorCaller, secretOf } from './support/core-fixtures.js';
import { withOperatorLogin } from './support/operator-login.js';
import { racingUnitOfWork } from './support/postgres-core.js';
import { unsealedFleetsOnly } from './support/sealing.js';

// Receiving again is a read (#1650): a crew's computer side that push
// receives the deliveries it already holds gets them back unchanged, with no
// event written and so no lock on the fleet's event sequence, the row every
// state change in the fleet waits on. Concurrent, failed and restarted push
// receives hold the delivery guarantees with held deliveries among them.

const newId = createIdGenerator();
/** How long a receive waits on an empty inbox in these tests: short, so an empty receive costs little. */
const WAIT_MS = 500;
/** The held deliveries Bridge received again on every look in #1646. */
const HELD = 15;
/** The most one push receive takes. */
const MAX = 10;
/** Long enough for a push receive that takes no fleet lock, and well inside a unit of work's 5 second timeout, so one that waits for the lock still ends. */
const READ_WITHIN_MS = 2_000;

let databaseUrl: string;
let prisma: PrismaClient;
let useCases: UseCases;
let fleetId: FleetId;
let argo: ShipCaller;
let scout: Crew;

beforeEach(async () => {
  databaseUrl = await createMigratedDatabase();
  prisma = createPrismaClient(databaseUrl);
  useCases = createUseCases({ prisma, clock: systemClock, wakeups: createReceiverWakeups(), receiveWaitMs: WAIT_MS });
  const fleet = unwrap(await withOperatorLogin(prisma, useCases.initialiseFleet({ name: 'home fleet' })));
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  scout = await crewedReviewer('scout');
});

afterEach(async () => {
  await prisma.$disconnect();
});

async function crewedReviewer(name: string): Promise<Crew> {
  const { shipId, secret } = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name, type: 'reviewer' }));
  const { crewToken } = unwrap(await useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'DEVICE' }, harness: 'claude-code' }));
  return unwrap(await useCases.authenticate.byCrewToken(crewToken));
}

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

/** The crew holds `count` deliveries it received, oldest first. */
async function scoutHolds(count: number): Promise<DeliveryId[]> {
  const sent: DeliveryId[] = [];
  for (let index = 0; index < count; index += 1) {
    sent.push(await sendTo(toScout()));
  }
  const first = unwrap(await useCases.pushReceiveDeliveries(scout, { max: MAX })).deliveries.map((delivery) => delivery.deliveryId);
  const rest = unwrap(await useCases.pushReceiveDeliveries(scout, { max: MAX, excluding: first })).deliveries.map((delivery) => delivery.deliveryId);
  expect([...first, ...rest]).toEqual(sent);
  return sent;
}

/** Every held delivery received again, ten at a time, as Bridge looked in #1646. */
async function receiveAllAgain(crew: Crew): Promise<DeliveryId[]> {
  const first = unwrap(await useCases.pushReceiveDeliveries(crew, { max: MAX })).deliveries.map((delivery) => delivery.deliveryId);
  const rest = unwrap(await useCases.pushReceiveDeliveries(crew, { max: MAX, excluding: first })).deliveries.map((delivery) => delivery.deliveryId);
  return [...first, ...rest];
}

function toScout(): Selector {
  return { kind: 'ship', shipId: scout.shipId };
}

function storedOf(deliveryIds: readonly DeliveryId[]) {
  return prisma.delivery.findMany({ where: { id: { in: [...deliveryIds] } }, orderBy: { id: 'asc' } });
}

function eventCount() {
  return prisma.event.count({ where: { fleetId } });
}

/**
 * Holds the lock on the fleet's row that writing an event takes (its event
 * sequence) while `work` runs, and says whether `work` finished within
 * READ_WITHIN_MS. The lock goes at the end either way, so `work` then ends.
 */
async function finishesWhileFleetLocked<T>(work: () => Promise<T>): Promise<{ hasFinished: boolean; result: T }> {
  const locked = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  const holding = prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM fleets WHERE id = ${fleetId} FOR NO KEY UPDATE`;
      locked.resolve(undefined);
      await release.promise;
    },
    { timeout: 4 * READ_WITHIN_MS },
  );
  await locked.promise;
  const running = work();
  const timedOut = Symbol('timed out');
  const first = await Promise.race([running, new Promise<typeof timedOut>((resolve) => setTimeout(() => { resolve(timedOut); }, READ_WITHIN_MS))]);
  release.resolve(undefined);
  await holding;
  return { hasFinished: first !== timedOut, result: await running };
}

describe(`a crew receiving its ${String(HELD)} held deliveries again`, () => {
  it('gets them back unchanged, writes no event and takes no fleet lock', async () => {
    const held = await scoutHolds(HELD);
    const before = await storedOf(held);
    const eventsBefore = await eventCount();

    const { hasFinished, result } = await finishesWhileFleetLocked(() => receiveAllAgain(scout));

    expect(result).toEqual(held);
    expect(hasFinished).toBe(true);
    await expect(eventCount()).resolves.toBe(eventsBefore);
    await expect(storedOf(held)).resolves.toEqual(before);
  });
});

describe('a new crew of the ship, after a release', () => {
  it('records its own receipt of each delivery the last crew held', async () => {
    const held = await scoutHolds(2);
    unwrap(await useCases.releaseShip(argo, { shipId: scout.shipId }));
    const { secret } = unwrap(await useCases.getStartingPrompt(argo, { shipId: scout.shipId }));
    const { crewToken } = unwrap(await useCases.claimShip({ shipId: scout.shipId, secret: secretOf(secret), location: { kind: 'DEVICE' }, harness: 'claude-code' }));
    const nextCrew = unwrap(await useCases.authenticate.byCrewToken(crewToken));

    expect(unwrap(await useCases.pushReceiveDeliveries(nextCrew, { max: MAX })).deliveries.map((delivery) => delivery.deliveryId)).toEqual(held);

    const receipts = await prisma.event.findMany({ where: { fleetId, type: 'DeliveryReceived', deliveryId: held[0] }, orderBy: { seq: 'asc' } });
    expect(receipts.map((event) => event.details)).toEqual([{ leaseId: scout.leaseId }, { leaseId: nextCrew.leaseId }]);
  });
});

describe('a crew receiving its held deliveries again while another ship of its type receives', () => {
  it('never shares a delivery: the held stay its own, the one pending goes to one of them, with one receipt', async () => {
    const lookout = await crewedReviewer('lookout');
    const held = await scoutHolds(2);
    const pending = await sendTo({ kind: 'type', type: 'reviewer' });
    const receiptsBefore = await prisma.event.count({ where: { fleetId, type: 'DeliveryReceived' } });
    const racing = createPushReceiveDeliveries({
      sealing: unsealedFleetsOnly,
      uow: racingUnitOfWork({ prisma, transactions: 2 }, (tx, allArrived) => ({
        ...tx,
        deliveries: {
          ...tx.deliveries,
          findClaimableForUpdate: async (query) => {
            const found = await tx.deliveries.findClaimableForUpdate(query);
            await allArrived();
            return found;
          },
        },
      })),
      clock: systemClock,
      ids: newId,
      wakeups: createReceiverWakeups(),
      waitMs: WAIT_MS,
    });

    const [byScout, byLookout] = await Promise.all([racing(scout, { max: MAX }), racing(lookout, { max: MAX })]);

    const scoutGot = unwrap(byScout).deliveries.map((delivery) => delivery.deliveryId);
    const lookoutGot = unwrap(byLookout).deliveries.map((delivery) => delivery.deliveryId);
    expect(scoutGot.slice(0, 2)).toEqual(held);
    expect(lookoutGot.filter((deliveryId) => held.includes(deliveryId))).toEqual([]);
    expect([...scoutGot, ...lookoutGot].filter((deliveryId) => deliveryId === pending)).toEqual([pending]);
    // The lookout's first push receive also writes LeasePushed; the receipts are what the race is about.
    await expect(prisma.event.count({ where: { fleetId, type: 'DeliveryReceived' } })).resolves.toBe(receiptsBefore + 1);
    await expect(prisma.event.count({ where: { fleetId, type: 'DeliveryReceived', deliveryId: pending } })).resolves.toBe(1);
  });
});

describe('a push receive that fails midway, holding deliveries', () => {
  it('stores nothing: the held stay as they were, the pending stays pending, no event', async () => {
    const held = await scoutHolds(2);
    const pending = await sendTo(toScout());
    const before = await storedOf(held);
    const eventsBefore = await eventCount();
    const failing = createPushReceiveDeliveries({
      sealing: unsealedFleetsOnly,
      uow: {
        run: (work) =>
          createPrismaUnitOfWork(prisma).run((tx) =>
            work({
              ...tx,
              events: {
                ...tx.events,
                append: async (event) => {
                  await tx.events.append(event);
                  throw new Error('disk full');
                },
              },
            }),
          ),
      },
      clock: systemClock,
      ids: newId,
      wakeups: createReceiverWakeups(),
      waitMs: WAIT_MS,
    });

    await expect(failing(scout, { max: MAX })).rejects.toThrow('disk full');

    await expect(storedOf(held)).resolves.toEqual(before);
    await expect(prisma.delivery.findUniqueOrThrow({ where: { id: pending } })).resolves.toMatchObject({ state: 'pending', claimedByLeaseId: null });
    await expect(eventCount()).resolves.toBe(eventsBefore);
  });
});

describe('a restart of the server, the crew holding deliveries', () => {
  it('returns them again unchanged, with no event', async () => {
    const held = await scoutHolds(HELD);
    const before = await storedOf(held);
    const eventsBefore = await eventCount();

    const restarted = createPrismaClient(databaseUrl);
    try {
      const afterRestart = createUseCases({ prisma: restarted, clock: systemClock, wakeups: createReceiverWakeups(), receiveWaitMs: WAIT_MS });
      const first = unwrap(await afterRestart.pushReceiveDeliveries(scout, { max: MAX })).deliveries.map((delivery) => delivery.deliveryId);
      const rest = unwrap(await afterRestart.pushReceiveDeliveries(scout, { max: MAX, excluding: first })).deliveries.map((delivery) => delivery.deliveryId);

      expect([...first, ...rest]).toEqual(held);
      await expect(storedOf(held)).resolves.toEqual(before);
      await expect(eventCount()).resolves.toBe(eventsBefore);
    } finally {
      await restarted.$disconnect();
    }
  });
});
