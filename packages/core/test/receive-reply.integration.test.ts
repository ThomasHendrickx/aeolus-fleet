import { createIdGenerator, idSchema, type DeliveryId, type MessageId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import type { PrismaTx } from '../src/adapters/prisma/unit-of-work.js';
import { createReceiveReply } from '../src/domain/messaging/receive-reply.js';
import type { ShipCaller, Crew } from '../src/domain/shared/caller.js';
import type { Selector } from '../src/domain/shared/selector.js';
import type { UnitOfWork } from '../src/domain/shared/unit-of-work.js';
import { createUseCases, systemClock, type UseCases } from '../src/wiring.js';
import { operatorCaller, secretOf } from './support/core-fixtures.js';
import { createMigratedDatabase } from '../src/testing/database.js';
import { newKey } from '../src/testing/keys.js';
import { racingUnitOfWork } from './support/postgres-core.js';
import { unwrap } from '../src/testing/result.js';
import { withOperatorLogin } from './support/operator-login.js';
import { unsealedFleetsOnly } from './support/sealing.js';

// Receiving the reply to one message on a real Postgres: the claim's filter in
// SQL, a reply in flight handed again, concurrent receivers that never share a
// reply, and a receiveReply that answers at once when no reply is there.

const newId = createIdGenerator();
/** Well under any wait a call once had: an answer this soon did not wait. */
const AT_ONCE_MS = 1_000;

let prisma: PrismaClient;
let useCases: UseCases;
let argo: ShipCaller;
let scout: Crew;
let lookout: Crew;

beforeEach(async () => {
  const databaseUrl = await createMigratedDatabase();
  prisma = createPrismaClient(databaseUrl);
  useCases = createUseCases({ prisma, clock: systemClock });
  const fleet = unwrap(await withOperatorLogin(prisma, useCases.initialiseFleet({ name: 'home fleet' })));
  argo = operatorCaller(fleet);
  scout = await crewedReviewer('scout');
  lookout = await crewedReviewer('lookout');
});

afterEach(async () => {
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

function receiveReplyWith(uow: UnitOfWork<PrismaTx>) {
  return createReceiveReply({ sealing: unsealedFleetsOnly, uow, clock: systemClock, ids: newId });
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

describe('a receiveReply with no reply there yet (decision 0072)', () => {
  it('answers at once with nothing, and hands the reply that commits later to the next look', async () => {
    const request = await ask();
    const startedAt = performance.now();

    await expect(useCases.receiveReply(scout, { messageId: request })).resolves.toEqual({ isOk: true, value: { deliveries: [] } });
    expect(performance.now() - startedAt).toBeLessThan(AT_ONCE_MS);
    const reply = await sendFromArgo(toScout(), request);

    expect(unwrap(await useCases.receiveReply(scout, { messageId: request })).deliveries.map((delivery) => delivery.deliveryId)).toEqual([reply]);
  });
});
