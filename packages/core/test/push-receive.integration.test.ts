import { createIdGenerator, idSchema, type DeliveryId, type FleetId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createReceiverWakeups } from '../src/adapters/prisma/receiver-wakeups.js';
import { createPrismaUnitOfWork } from '../src/adapters/prisma/unit-of-work.js';
import { createHandOverDelivery } from '../src/domain/messaging/hand-over-delivery.js';
import { createPushReceiveDeliveries } from '../src/domain/messaging/push-receive-deliveries.js';
import type { ShipCaller, Crew } from '../src/domain/shared/caller.js';
import type { Selector } from '../src/domain/shared/selector.js';
import { createUseCases, systemClock, type UseCases } from '../src/wiring.js';
import { operatorCaller, secretOf } from './support/core-fixtures.js';
import { createMigratedDatabase } from '../src/testing/database.js';
import { newKey } from '../src/testing/keys.js';
import { racingUnitOfWork } from './support/postgres-core.js';
import { unwrap } from '../src/testing/result.js';
import { withOperatorLogin } from './support/operator-login.js';
import { unsealedFleetsOnly } from './support/sealing.js';

// Push receive and hand-over on a real Postgres (decision 0040): what a push
// receive stores and how it marks the lease pushed, that concurrent push
// receivers never share a delivery and concurrent hand-overs with one number
// count one attempt, that a push receive which fails midway stores nothing,
// and that a restart of the server loses nothing the computer side holds.

const newId = createIdGenerator();
/** How long a receive waits on an empty inbox in these tests: short, so an empty receive costs little. */
const WAIT_MS = 500;

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
  useCases = createUseCases({ prisma, clock: systemClock, wakeups: createReceiverWakeups(), receiveWaitMs: WAIT_MS });
  const fleet = unwrap(await withOperatorLogin(prisma, useCases.initialiseFleet({ name: 'home fleet' })));
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  scout = await crewedReviewer('scout');
  lookout = await crewedReviewer('lookout');
});

afterEach(async () => {
  await prisma.$disconnect();
});

async function crewedReviewer(name: string): Promise<Crew> {
  const { shipId, secret } = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name, type: 'reviewer' }));
  const { crewToken } = unwrap(
    await useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'DEVICE' }, harness: 'claude-code' }),
  );
  return unwrap(await useCases.authenticate.byCrewToken(crewToken));
}

const toShip = (crew: Crew): Selector => ({ kind: 'ship', shipId: crew.shipId });
const toReviewers: Selector = { kind: 'type', type: 'reviewer' };

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

async function pushReceive(crew: Crew, max?: number): Promise<DeliveryId[]> {
  const { deliveries } = unwrap(await useCases.pushReceiveDeliveries(crew, max === undefined ? {} : { max }));
  return deliveries.map((delivery) => delivery.deliveryId);
}

function stored(deliveryId: DeliveryId) {
  return prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } });
}

function eventTypesOf(deliveryId: DeliveryId) {
  return prisma.event
    .findMany({ where: { fleetId, deliveryId }, orderBy: { seq: 'asc' } })
    .then((events) => events.map((event) => event.type));
}

describe('a push receive on Postgres', () => {
  it('takes the 11th delivery behind ten held hand-overs when only never handed are requested', async () => {
    const held: DeliveryId[] = [];
    for (let index = 0; index < 10; index += 1) {
      held.push(await sendTo(toShip(scout)));
    }
    await pushReceive(scout, 10);
    for (const deliveryId of held) {
      unwrap(await useCases.handOverDelivery(scout, { deliveryId, handOverNumber: 1 }));
    }
    const eleventh = await sendTo(toShip(scout));

    const input = { max: 10, shouldSkipHanded: true };
    const { deliveries } = unwrap(await useCases.pushReceiveDeliveries(scout, input));

    expect(deliveries.map((delivery) => delivery.deliveryId)).toEqual([eleventh]);
    // A lost answer before hand-over must still return the received delivery.
    const again = unwrap(await useCases.pushReceiveDeliveries(scout, input));
    expect(again.deliveries.map((delivery) => delivery.deliveryId)).toEqual([eleventh]);
  });

  it('takes the 11th delivery behind ten received ones when those ten are excluded', async () => {
    const sent: DeliveryId[] = [];
    for (let index = 0; index < 11; index += 1) {
      sent.push(await sendTo(toShip(scout)));
    }
    const firstTen = await pushReceive(scout, 10);

    const { deliveries } = unwrap(await useCases.pushReceiveDeliveries(scout, { max: 10, excluding: firstTen }));

    expect(deliveries.map((delivery) => delivery.deliveryId)).toEqual([sent[10]]);
  });

  it("stores the delivery received, in flight with the ship and its crew's lease, no attempt, and DeliveryReceived", async () => {
    const deliveryId = await sendTo(toShip(scout));

    expect(await pushReceive(scout)).toEqual([deliveryId]);

    await expect(stored(deliveryId)).resolves.toMatchObject({
      state: 'received',
      claimedByShipId: scout.shipId,
      claimedByLeaseId: scout.leaseId,
      attempts: 0,
      handOverNumber: null,
    });
    await expect(eventTypesOf(deliveryId)).resolves.toEqual(['MessageAccepted', 'DeliveryReceived']);
  });

  it('returns its own received and handed deliveries again first, with their state and hand-over number, changing nothing', async () => {
    const handed = await sendTo(toShip(scout));
    const received = await sendTo(toShip(scout));
    await pushReceive(scout, 2);
    unwrap(await useCases.handOverDelivery(scout, { deliveryId: handed, handOverNumber: 1 }));
    const pending = await sendTo(toShip(scout));

    const { deliveries } = unwrap(await useCases.pushReceiveDeliveries(scout, { max: 3 }));

    expect(deliveries.map(({ deliveryId, state, handOverNumber }) => ({ deliveryId, state, handOverNumber }))).toEqual([
      { deliveryId: handed, state: 'handed', handOverNumber: 1 },
      { deliveryId: received, state: 'received', handOverNumber: null },
      { deliveryId: pending, state: 'received', handOverNumber: null },
    ]);
    await expect(stored(handed)).resolves.toMatchObject({ state: 'handed', attempts: 1, handOverNumber: 1 });
  });

  it('marks the lease pushed: a plain receive then answers nothing and claims nothing, until the lease ends', async () => {
    await pushReceive(scout);
    const deliveryId = await sendTo(toShip(scout));

    await expect(useCases.receiveDeliveries(scout, {})).resolves.toEqual({ isOk: true, value: { deliveries: [] } });
    await expect(stored(deliveryId)).resolves.toMatchObject({ state: 'pending', attempts: 0 });
    const { pushedAt } = await prisma.lease.findUniqueOrThrow({ where: { id: scout.leaseId } });
    expect(pushedAt).toBeInstanceOf(Date);
  });

  it('returns received and handed deliveries to pending when the lease ends, their hand-over number cleared', async () => {
    const received = await sendTo(toShip(scout));
    const handed = await sendTo(toShip(scout));
    await pushReceive(scout, 2);
    unwrap(await useCases.handOverDelivery(scout, { deliveryId: handed, handOverNumber: 1 }));

    unwrap(await useCases.releaseShip(argo, { shipId: scout.shipId }));

    await expect(stored(received)).resolves.toMatchObject({ state: 'pending', claimedByLeaseId: null, handOverNumber: null, attempts: 0 });
    await expect(stored(handed)).resolves.toMatchObject({ state: 'pending', claimedByLeaseId: null, handOverNumber: null, attempts: 1 });
  });
});

describe('handed on Postgres', () => {
  it('counts one attempt per higher hand-over number, none for a repeat, and the fifth is undeliverable', async () => {
    const deliveryId = await sendTo(toShip(scout));
    await pushReceive(scout);

    const states = [];
    for (const number of [1, 1, 2, 3, 4, 5]) {
      states.push(unwrap(await useCases.handOverDelivery(scout, { deliveryId, handOverNumber: number })).state);
    }

    expect(states).toEqual(['handed', 'handed', 'handed', 'handed', 'handed', 'undeliverable']);
    await expect(stored(deliveryId)).resolves.toMatchObject({ state: 'undeliverable', attempts: 5, claimedByLeaseId: null });
    await expect(eventTypesOf(deliveryId)).resolves.toEqual([
      'MessageAccepted',
      'DeliveryReceived',
      'DeliveryHanded',
      'DeliveryHanded',
      'DeliveryHanded',
      'DeliveryHanded',
      'DeliveryUndeliverable',
    ]);
  });
});

describe('concurrent push receivers of one type', () => {
  it('never get the same delivery, even while both hold their receipts open', async () => {
    const sent = [await sendTo(toReviewers), await sendTo(toReviewers), await sendTo(toReviewers), await sendTo(toReviewers)];
    const racing = createPushReceiveDeliveries({ sealing: unsealedFleetsOnly,
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

    const [byScout, byLookout] = await Promise.all([racing(scout, { max: 2 }), racing(lookout, { max: 2 })]);

    const scoutGot = unwrap(byScout).deliveries.map((delivery) => delivery.deliveryId);
    const lookoutGot = unwrap(byLookout).deliveries.map((delivery) => delivery.deliveryId);
    expect(scoutGot).toHaveLength(2);
    expect(lookoutGot).toHaveLength(2);
    expect([...scoutGot, ...lookoutGot].sort()).toEqual([...sent].sort());
  });

  it('let one crew mark its lease pushed twice at once without a deadlock', async () => {
    const results = await Promise.all([pushReceive(scout), pushReceive(scout), pushReceive(scout)]);

    expect(results).toEqual([[], [], []]);
    await expect(prisma.event.count({ where: { fleetId, type: 'LeasePushed', shipId: scout.shipId } })).resolves.toBe(1);
  });
});

describe('concurrent hand-overs of one delivery', () => {
  it('with the same hand-over number count one attempt and write one DeliveryHanded', async () => {
    const deliveryId = await sendTo(toShip(scout));
    await pushReceive(scout);
    const racing = createHandOverDelivery({
      uow: racingUnitOfWork({ prisma, transactions: 2 }, (tx, allArrived) => ({
        ...tx,
        leases: {
          ...tx.leases,
          findOpenByIdForShare: async (fleet, leaseId) => {
            const lease = await tx.leases.findOpenByIdForShare(fleet, leaseId);
            await allArrived();
            return lease;
          },
        },
      })),
      clock: systemClock,
      ids: newId,
    });

    const answers = await Promise.all([
      racing(scout, { deliveryId, handOverNumber: 1 }),
      racing(scout, { deliveryId, handOverNumber: 1 }),
    ]);

    expect(answers.map((answer) => unwrap(answer).state)).toEqual(['handed', 'handed']);
    await expect(stored(deliveryId)).resolves.toMatchObject({ state: 'handed', attempts: 1, handOverNumber: 1 });
    await expect(eventTypesOf(deliveryId)).resolves.toEqual(['MessageAccepted', 'DeliveryReceived', 'DeliveryHanded']);
  });
});

describe('a push receive that fails midway', () => {
  it('stores nothing: the delivery stays pending, no event, and the lease is not pushed', async () => {
    const deliveryId = await sendTo(toShip(scout));
    const failing = createPushReceiveDeliveries({ sealing: unsealedFleetsOnly,
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

    await expect(failing(scout, {})).rejects.toThrow('disk full');

    await expect(stored(deliveryId)).resolves.toMatchObject({ state: 'pending', claimedByLeaseId: null, attempts: 0 });
    await expect(eventTypesOf(deliveryId)).resolves.toEqual(['MessageAccepted']);
    await expect(prisma.lease.findUniqueOrThrow({ where: { id: scout.leaseId } })).resolves.toMatchObject({ pushedAt: null });
    await expect(prisma.event.count({ where: { fleetId, type: 'LeasePushed' } })).resolves.toBe(0);
  });
});

describe('a restart of the server', () => {
  it('loses nothing the computer side holds: received and handed come back as they were, and the lease stays pushed', async () => {
    const received = await sendTo(toShip(scout));
    const handed = await sendTo(toShip(scout));
    await pushReceive(scout, 2);
    unwrap(await useCases.handOverDelivery(scout, { deliveryId: handed, handOverNumber: 1 }));
    const pending = await sendTo(toShip(scout));

    const restarted = createPrismaClient(databaseUrl);
    try {
      const afterRestart = createUseCases({ prisma: restarted, clock: systemClock, wakeups: createReceiverWakeups(), receiveWaitMs: WAIT_MS });

      const { deliveries } = unwrap(await afterRestart.pushReceiveDeliveries(scout, { max: 3 }));
      const repeat = unwrap(await afterRestart.handOverDelivery(scout, { deliveryId: handed, handOverNumber: 1 }));

      expect(deliveries.map(({ deliveryId, state }) => ({ deliveryId, state }))).toEqual([
        { deliveryId: received, state: 'received' },
        { deliveryId: handed, state: 'handed' },
        { deliveryId: pending, state: 'received' },
      ]);
      expect(repeat.state).toBe('handed');
      await expect(stored(handed)).resolves.toMatchObject({ attempts: 1, handOverNumber: 1 });
      await expect(afterRestart.receiveDeliveries(scout, {})).resolves.toEqual({ isOk: true, value: { deliveries: [] } });
    } finally {
      await restarted.$disconnect();
    }
  });
});

describe('forced deliveries on Postgres (decision 0040)', () => {
  it("come first: before the crew's own in flight and older pending ones, oldest forced first", async () => {
    const inFlight = await sendTo(toShip(scout));
    expect(await pushReceive(scout)).toEqual([inFlight]);
    const older = await sendTo(toShip(scout));
    const firstForced = await sendTo(toShip(scout), { isForced: true });
    const secondForced = await sendTo(toReviewers, { isForced: true });

    expect(await pushReceive(scout, 4)).toEqual([firstForced, secondForced, inFlight, older]);
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

  it('are counted apart in the inbox check while received and not handed, and say they were forced', async () => {
    const forced = await sendTo(toShip(scout), { isForced: true });
    await sendTo(toShip(scout));

    const [first] = unwrap(await useCases.pushReceiveDeliveries(scout, {})).deliveries;

    expect(first).toMatchObject({ deliveryId: forced, isForced: true });
    await expect(useCases.checkInbox(scout, {})).resolves.toEqual({ isOk: true, value: { waiting: 2, forced: 1 } });
    unwrap(await useCases.handOverDelivery(scout, { deliveryId: forced, handOverNumber: 1 }));
    await expect(useCases.checkInbox(scout, {})).resolves.toEqual({ isOk: true, value: { waiting: 2, forced: 0 } });
  });

  it('go to concurrent receivers of one type before any older plain delivery, each exactly once, while both hold their claims open', async () => {
    const plain = [await sendTo(toReviewers), await sendTo(toReviewers)];
    const forced = [await sendTo(toReviewers, { isForced: true }), await sendTo(toReviewers, { isForced: true })];
    const racing = createPushReceiveDeliveries({ sealing: unsealedFleetsOnly,
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

    const [byScout, byLookout] = await Promise.all([racing(scout, { max: 1 }), racing(lookout, { max: 1 })]);

    const got = [...unwrap(byScout).deliveries, ...unwrap(byLookout).deliveries].map((delivery) => delivery.deliveryId);
    expect(got.sort()).toEqual([...forced].sort());
    await expect(prisma.delivery.findMany({ where: { id: { in: plain } }, select: { state: true } })).resolves.toEqual([
      { state: 'pending' },
      { state: 'pending' },
    ]);
    await expect(prisma.delivery.count({ where: { id: { in: forced }, state: 'received' } })).resolves.toBe(2);
  });
});
