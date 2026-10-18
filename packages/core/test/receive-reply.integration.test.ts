import { createIdGenerator, idSchema, type DeliveryId, type MessageId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { listenForPendingDeliveries, type DeliveryListener } from '../src/adapters/prisma/delivery-notices.js';
import { createReceiverWakeups, type ReceiverWakeupHub } from '../src/adapters/prisma/receiver-wakeups.js';
import { createPrismaUnitOfWork, type PrismaTx } from '../src/adapters/prisma/unit-of-work.js';
import { createReceiveReply } from '../src/domain/messaging/receive-reply.js';
import type { Caller, Crew } from '../src/domain/shared/caller.js';
import type { Selector } from '../src/domain/shared/selector.js';
import type { UnitOfWork } from '../src/domain/shared/unit-of-work.js';
import { createUseCases, systemClock, type UseCases } from '../src/wiring.js';
import { OPERATOR, operatorCaller, secretOf } from './support/core-fixtures.js';
import { createMigratedDatabase } from './support/database.js';
import { newKey } from './support/keys.js';
import { racingUnitOfWork } from './support/postgres-core.js';
import { unwrap } from './support/result.js';

// Receiving the reply to one message on a real Postgres, with the listener and
// the wake-ups the server runs: the claim's filter in SQL, a reply in flight
// handed again, concurrent receivers that never share a reply, and a waiting
// receiveReply that wakes when the reply commits.

const newId = createIdGenerator();
/** How long a receive waits on an empty inbox in these tests: short, so an empty receive costs little. */
const WAIT_MS = 2_000;
/** The wait of a receive that must end early: it proves a wake-up, not a timeout. */
const LONG_WAIT_MS = 15_000;
/** Time for a receive to start waiting before the test sends. */
const SETTLE_MS = 300;

let prisma: PrismaClient;
let wakeups: ReceiverWakeupHub;
let listener: DeliveryListener;
let useCases: UseCases;
let argo: Caller;
let scout: Crew;
let lookout: Crew;

beforeEach(async () => {
  const databaseUrl = await createMigratedDatabase();
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
  useCases = createUseCases({ prisma, clock: systemClock, wakeups, receiveWaitMs: WAIT_MS });
  const fleet = unwrap(await useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR }));
  argo = operatorCaller(fleet);
  scout = await crewedReviewer('scout');
  lookout = await crewedReviewer('lookout');
});

afterEach(async () => {
  await listener.close();
  await prisma.$disconnect();
});

async function crewedReviewer(name: string): Promise<Crew> {
  const { shipId, secret } = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name, type: 'reviewer' }));
  const { crewToken } = unwrap(await useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'CLOUD' }, harness: 'claude-code' }));
  return unwrap(await useCases.authenticate.byCrewToken(crewToken));
}

/** Scout asks argo something, and gets the request's message id. */
async function ask(): Promise<MessageId> {
  const { messageId } = unwrap(
    await useCases.sendMessage(scout, {
      selector: { kind: 'ship', shipId: argo.shipId },
      payload: 'Look up account 42',
      contentType: 'text/plain',
      model: 'claude-opus-5-5',
      idempotencyKey: newKey(),
    }),
  );
  return messageId;
}

/** Argo sends a message, a reply to `inReplyTo` when given, and gets its delivery's id. */
async function sendFromArgo(selector: Selector, inReplyTo?: MessageId): Promise<DeliveryId> {
  const { messageId } = unwrap(
    await useCases.sendMessage(argo, {
      selector,
      payload: 'Account 42 is Acme',
      contentType: 'text/plain',
      idempotencyKey: newKey(),
      ...(inReplyTo === undefined ? {} : { inReplyTo }),
    }),
  );
  const { id } = await prisma.delivery.findFirstOrThrow({ where: { messageId } });
  return idSchema('delivery').parse(id);
}

const toScout = (): Selector => ({ kind: 'ship', shipId: scout.shipId });
const toReviewers: Selector = { kind: 'type', type: 'reviewer' };

async function receiveReplyTo(crew: Crew, messageId: MessageId): Promise<DeliveryId[]> {
  const { deliveries } = unwrap(await useCases.receiveReply(crew, { messageId }));
  return deliveries.map((delivery) => delivery.deliveryId);
}

function receiveReplyWith(uow: UnitOfWork<PrismaTx>, waitMs = WAIT_MS) {
  return createReceiveReply({ uow, clock: systemClock, ids: newId, wakeups, waitMs });
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('receiving the reply to one message on Postgres', () => {
  it('hands the oldest reply to that message, passing over older deliveries that are no reply or reply to another message', async () => {
    const [request, other] = [await ask(), await ask()];
    const plain = await sendFromArgo(toScout());
    const toOther = await sendFromArgo(toScout(), other);
    const reply = await sendFromArgo(toScout(), request);
    const later = await sendFromArgo(toScout(), request);

    expect(await receiveReplyTo(scout, request)).toEqual([reply]);
    const states = await prisma.delivery.findMany({ where: { id: { in: [plain, toOther, reply, later] } }, select: { id: true, state: true, attempts: true } });
    expect(new Map(states.map((held) => [held.id, [held.state, held.attempts]]))).toEqual(
      new Map([
        [plain, ['pending', 0]],
        [toOther, ['pending', 0]],
        [reply, ['handed', 1]],
        [later, ['pending', 0]],
      ]),
    );
  });

  it("hands a reply in flight with the crew's lease again as another attempt, and never another delivery it holds in flight", async () => {
    const request = await ask();
    await sendFromArgo(toScout());
    unwrap(await useCases.receiveDeliveries(scout, {}));
    const reply = await sendFromArgo(toScout(), request);
    await receiveReplyTo(scout, request);

    expect(await receiveReplyTo(scout, request)).toEqual([reply]);
    await expect(prisma.delivery.findUniqueOrThrow({ where: { id: reply } })).resolves.toMatchObject({ attempts: 2 });
  });
});

describe('concurrent receivers of replies to one message', () => {
  it('never get the same reply, even while both hold their claims open', async () => {
    const request = await ask();
    const sent = [await sendFromArgo(toReviewers, request), await sendFromArgo(toReviewers, request)];
    const racing = receiveReplyWith(
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

    const [byScout, byLookout] = await Promise.all([racing(scout, { messageId: request }), racing(lookout, { messageId: request })]);

    const got = [...unwrap(byScout).deliveries, ...unwrap(byLookout).deliveries].map((delivery) => delivery.deliveryId);
    expect(got.sort()).toEqual([...sent].sort());
  });
});

describe('a receiveReply waiting for its reply', () => {
  it('returns as soon as the reply commits, and not for a delivery that is no reply to that message', async () => {
    const request = await ask();
    const startedAt = performance.now();
    const receiving = receiveReplyWith(createPrismaUnitOfWork(prisma), LONG_WAIT_MS)(scout, { messageId: request });
    await pause(SETTLE_MS);

    const plain = await sendFromArgo(toScout());
    await pause(SETTLE_MS);
    const reply = await sendFromArgo(toScout(), request);

    expect(unwrap(await receiving).deliveries.map((delivery) => delivery.deliveryId)).toEqual([reply]);
    expect(performance.now() - startedAt).toBeLessThan(LONG_WAIT_MS / 2);
    await expect(prisma.delivery.findUniqueOrThrow({ where: { id: plain } })).resolves.toMatchObject({ state: 'pending' });
  });
});
