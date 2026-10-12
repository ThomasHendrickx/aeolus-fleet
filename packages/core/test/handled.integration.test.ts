import { createIdGenerator, idSchema, type DeliveryId, type FleetId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createReceiverWakeups } from '../src/adapters/prisma/receiver-wakeups.js';
import { createPrismaUnitOfWork, type PrismaTx } from '../src/adapters/prisma/unit-of-work.js';
import { createHandOverDelivery } from '../src/domain/messaging/hand-over-delivery.js';
import { createReportHandled } from '../src/domain/messaging/report-handled.js';
import { createReportNotHandled } from '../src/domain/messaging/report-not-handled.js';
import type { Caller, Crew } from '../src/domain/shared/caller.js';
import type { UnitOfWork } from '../src/domain/shared/unit-of-work.js';
import { createUseCases, systemClock, type UseCases } from '../src/wiring.js';
import { OPERATOR, operatorCaller, secretOf } from './support/core-fixtures.js';
import { createMigratedDatabase } from './support/database.js';
import { newKey } from './support/keys.js';
import { racingUnitOfWork } from './support/postgres-core.js';
import { unwrap } from './support/result.js';

// Handled, handed once more and not handled on a real Postgres (decision
// 0040): what each stores and writes, that a handled and a not handled report
// racing on one delivery leave exactly one of them, that one which fails
// midway stores nothing, and that a restart of the server keeps the once more.

const newId = createIdGenerator();
/** How long a receive waits on an empty inbox in these tests: short, so an empty receive costs little. */
const WAIT_MS = 500;

let databaseUrl: string;
let prisma: PrismaClient;
let useCases: UseCases;
let fleetId: FleetId;
let argo: Caller;
let scout: Crew;

beforeEach(async () => {
  databaseUrl = await createMigratedDatabase();
  prisma = createPrismaClient(databaseUrl);
  useCases = createUseCases({ prisma, clock: systemClock, wakeups: createReceiverWakeups(), receiveWaitMs: WAIT_MS });
  const fleet = unwrap(await useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR }));
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  const { shipId, secret } = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
  const { crewToken } = unwrap(
    await useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'DEVICE' }, harness: 'claude-code' }),
  );
  scout = unwrap(await useCases.authenticate.byCrewToken(crewToken));
});

afterEach(async () => {
  await prisma.$disconnect();
});

/** A delivery to the scout, push received, handed as number 1 and acknowledged by the hook. */
async function acknowledged(): Promise<DeliveryId> {
  const { messageId } = unwrap(
    await useCases.sendMessage(argo, {
      selector: { kind: 'ship', shipId: scout.shipId },
      payload: 'Review https://github.com/ThomasHendrickx/aeolus-fleet/pull/25',
      contentType: 'text/plain',
      idempotencyKey: `review-${newId('message')}`,
    }),
  );
  const deliveryId = idSchema('delivery').parse((await prisma.delivery.findFirstOrThrow({ where: { messageId } })).id);
  unwrap(await useCases.pushReceiveDeliveries(scout, {}));
  unwrap(await useCases.handOverDelivery(scout, { deliveryId, handOverNumber: 1 }));
  unwrap(await useCases.acknowledgeDelivery(scout, { deliveryId }));
  return deliveryId;
}

/** Acknowledged, and handed once more as number 2 after its turn died. */
async function handedOnceMore(): Promise<DeliveryId> {
  const deliveryId = await acknowledged();
  unwrap(await useCases.handOverDelivery(scout, { deliveryId, handOverNumber: 2, isOnceMore: true }));
  return deliveryId;
}

function stored(deliveryId: DeliveryId) {
  return prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } });
}

function eventsOf(deliveryId: DeliveryId) {
  return prisma.event.findMany({ where: { fleetId, deliveryId }, orderBy: { seq: 'asc' } });
}

async function eventTypesOf(deliveryId: DeliveryId): Promise<string[]> {
  return (await eventsOf(deliveryId)).map((event) => event.type);
}

/** Two transactions held once each has held the crew's lease, so they race for the delivery's lock. */
function racingAtTheLease() {
  return racingUnitOfWork({ prisma, transactions: 2 }, (tx, allArrived): PrismaTx => ({
    ...tx,
    leases: {
      ...tx.leases,
      findOpenByIdForShare: async (fleet, leaseId) => {
        const lease = await tx.leases.findOpenByIdForShare(fleet, leaseId);
        await allArrived();
        return lease;
      },
    },
  }));
}

/** The Prisma unit of work, failing right after it wrote its first event: the disk filled up. */
function failingAtTheEvent(): UnitOfWork<PrismaTx> {
  return {
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
  };
}

describe('handled on Postgres', () => {
  it('stores the delivery handled, keeping who it was handed to, with DeliveryHandled', async () => {
    const deliveryId = await acknowledged();

    unwrap(await useCases.reportHandled(scout, { deliveryId }));

    await expect(stored(deliveryId)).resolves.toMatchObject({
      state: 'handled',
      claimedByShipId: scout.shipId,
      claimedByLeaseId: scout.leaseId,
      attempts: 1,
    });
    await expect(eventTypesOf(deliveryId)).resolves.toEqual([
      'MessageAccepted',
      'DeliveryReceived',
      'DeliveryHanded',
      'DeliveryAcknowledged',
      'DeliveryHandled',
    ]);
  });

  it('keeps an acknowledged delivery acknowledged when the lease ends, and refuses its handled after', async () => {
    const deliveryId = await acknowledged();

    unwrap(await useCases.releaseShip(argo, { shipId: scout.shipId }));

    await expect(useCases.reportHandled(scout, { deliveryId })).resolves.toMatchObject({ isOk: false, error: { kind: 'LEASE_ENDED' } });
    await expect(stored(deliveryId)).resolves.toMatchObject({ state: 'acknowledged', claimedByLeaseId: scout.leaseId });
  });
});

describe('handed once more on Postgres', () => {
  it('stores when it was handed once more and its number, counting no attempt, with DeliveryHanded marked once more', async () => {
    const deliveryId = await handedOnceMore();

    const delivery = await stored(deliveryId);
    expect(delivery).toMatchObject({ state: 'acknowledged', attempts: 1, handOverNumber: 2 });
    expect(delivery.handedOnceMoreAt).toBeInstanceOf(Date);
    expect((await eventsOf(deliveryId)).at(-1)).toMatchObject({
      type: 'DeliveryHanded',
      details: { leaseId: scout.leaseId, attempts: 1, handOverNumber: 2, onceMore: true },
    });
  });
});

describe('not handled on Postgres', () => {
  it('stores the delivery not handled, with DeliveryNotHandled', async () => {
    const deliveryId = await handedOnceMore();

    unwrap(await useCases.reportNotHandled(scout, { deliveryId }));

    await expect(stored(deliveryId)).resolves.toMatchObject({ state: 'notHandled', claimedByLeaseId: scout.leaseId });
    await expect(eventTypesOf(deliveryId)).resolves.toEqual([
      'MessageAccepted',
      'DeliveryReceived',
      'DeliveryHanded',
      'DeliveryAcknowledged',
      'DeliveryHanded',
      'DeliveryNotHandled',
    ]);
  });
});

describe('a handled and a not handled report racing on one delivery', () => {
  it('leave exactly one of them: the other is refused, and one event is written', async () => {
    const deliveryId = await handedOnceMore();
    const uow = racingAtTheLease();
    const reportHandled = createReportHandled({ uow, clock: systemClock, ids: newId });
    const reportNotHandled = createReportNotHandled({ uow, clock: systemClock, ids: newId });

    const answers = await Promise.all([reportHandled(scout, { deliveryId }), reportNotHandled(scout, { deliveryId })]);

    expect(answers.filter((answer) => answer.isOk)).toHaveLength(1);
    expect(answers.filter((answer) => !answer.isOk)).toMatchObject([{ error: { kind: 'DELIVERY_NOT_ACKNOWLEDGED' } }]);
    const { state } = await stored(deliveryId);
    const ends = (await eventTypesOf(deliveryId)).filter((type) => type === 'DeliveryHandled' || type === 'DeliveryNotHandled');
    expect(ends).toEqual([state === 'handled' ? 'DeliveryHandled' : 'DeliveryNotHandled']);
  });
});

describe('concurrent once more hand-overs of one delivery', () => {
  it('with the same hand-over number hand it once more once: one DeliveryHanded marked once more', async () => {
    const deliveryId = await acknowledged();
    const racing = createHandOverDelivery({ uow: racingAtTheLease(), clock: systemClock, ids: newId });

    const answers = await Promise.all([
      racing(scout, { deliveryId, handOverNumber: 2, isOnceMore: true }),
      racing(scout, { deliveryId, handOverNumber: 2, isOnceMore: true }),
    ]);

    expect(answers.map((answer) => unwrap(answer).state)).toEqual(['acknowledged', 'acknowledged']);
    const onceMore = (await eventsOf(deliveryId)).filter((event) => event.type === 'DeliveryHanded').slice(1);
    expect(onceMore).toMatchObject([{ details: { handOverNumber: 2, onceMore: true } }]);
  });
});

describe('a handled report that fails midway', () => {
  it('stores nothing: the delivery stays acknowledged, and no DeliveryHandled', async () => {
    const deliveryId = await acknowledged();
    const failing = createReportHandled({ uow: failingAtTheEvent(), clock: systemClock, ids: newId });

    await expect(failing(scout, { deliveryId })).rejects.toThrow('disk full');

    await expect(stored(deliveryId)).resolves.toMatchObject({ state: 'acknowledged' });
    await expect(eventTypesOf(deliveryId)).resolves.not.toContain('DeliveryHandled');
  });
});

describe('a not handled report that fails midway', () => {
  it('stores nothing: the delivery stays acknowledged, and no DeliveryNotHandled', async () => {
    const deliveryId = await handedOnceMore();
    const failing = createReportNotHandled({ uow: failingAtTheEvent(), clock: systemClock, ids: newId });

    await expect(failing(scout, { deliveryId })).rejects.toThrow('disk full');

    await expect(stored(deliveryId)).resolves.toMatchObject({ state: 'acknowledged' });
    await expect(eventTypesOf(deliveryId)).resolves.not.toContain('DeliveryNotHandled');
  });
});

describe('a once more that fails midway', () => {
  it('stores nothing: the delivery is not handed once more, and no DeliveryHanded is added', async () => {
    const deliveryId = await acknowledged();
    const failing = createHandOverDelivery({ uow: failingAtTheEvent(), clock: systemClock, ids: newId });

    await expect(failing(scout, { deliveryId, handOverNumber: 2, isOnceMore: true })).rejects.toThrow('disk full');

    await expect(stored(deliveryId)).resolves.toMatchObject({ state: 'acknowledged', handOverNumber: 1, handedOnceMoreAt: null });
    expect((await eventTypesOf(deliveryId)).filter((type) => type === 'DeliveryHanded')).toHaveLength(1);
  });
});

describe('a restart of the server', () => {
  it('keeps the once more: its repeat changes nothing, a second one is refused, and not handled is taken', async () => {
    const deliveryId = await handedOnceMore();

    const restarted = createPrismaClient(databaseUrl);
    try {
      const afterRestart = createUseCases({ prisma: restarted, clock: systemClock, wakeups: createReceiverWakeups(), receiveWaitMs: WAIT_MS });

      const repeat = await afterRestart.handOverDelivery(scout, { deliveryId, handOverNumber: 2, isOnceMore: true });
      const second = await afterRestart.handOverDelivery(scout, { deliveryId, handOverNumber: 3, isOnceMore: true });
      const notHandled = await afterRestart.reportNotHandled(scout, { deliveryId });

      expect(repeat).toEqual({ isOk: true, value: { state: 'acknowledged' } });
      expect(second).toMatchObject({ isOk: false, error: { kind: 'DELIVERY_HANDED_ONCE_MORE' } });
      expect(notHandled).toEqual({ isOk: true, value: undefined });
      await expect(stored(deliveryId)).resolves.toMatchObject({ state: 'notHandled', handOverNumber: 2 });
    } finally {
      await restarted.$disconnect();
    }
  });
});
