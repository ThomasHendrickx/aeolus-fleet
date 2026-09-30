import { createIdGenerator, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sha256Hasher } from '../src/adapters/crypto/secrets.js';
import { listenForPendingDeliveries, type DeliveryListener } from '../src/adapters/prisma/delivery-notices.js';
import { createPrismaUnitOfWork, type PrismaTx } from '../src/adapters/prisma/unit-of-work.js';
import type { DeliveryNotice } from '../src/core/messaging/ports.js';
import { createSendMessage, type MessageToSend } from '../src/core/messaging/send-message.js';
import type { Caller } from '../src/core/shared/caller.js';
import type { UnitOfWork } from '../src/core/shared/unit-of-work.js';
import { agentCaller, OPERATOR, operatorCaller } from './support/core-fixtures.js';
import { createPostgresCore, racingUnitOfWork, type PostgresCore } from './support/postgres-core.js';
import { unwrap } from './support/result.js';

// Sending a message on a real Postgres through the Prisma adapters: what a
// send stores, that nothing stays and nobody is woken when it fails, that a
// listener hears of it only once it commits, one message for concurrent sends
// with one key, the 64 KB limit in bytes, and that a send and a retire of the
// ship it addresses never pass each other.

const newId = createIdGenerator();
const KEY_REUSED = 'This idempotency key was already used for another message: send a new message with a new key';

let core: PostgresCore;
let fleetId: FleetId;
let argoId: ShipId;
let argo: Caller;
let scoutId: ShipId;
let scout: Caller;
let listener: DeliveryListener;
let notices: DeliveryNotice[];

beforeEach(async () => {
  core = await createPostgresCore();
  const fleet = unwrap(await core.useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR }));
  ({ fleetId, operatorShipId: argoId } = fleet);
  argo = operatorCaller(fleet);
  ({ shipId: scoutId } = unwrap(await core.useCases.commissionShip(argo, { name: 'scout', type: 'reviewer' })));
  scout = agentCaller({ fleetId, shipId: scoutId });
  core.clock.advance(60_000);
  notices = [];
  listener = await listenForPendingDeliveries({
    databaseUrl: core.databaseUrl,
    onNotice: (notice) => {
      notices.push(notice);
    },
  });
});

afterEach(async () => {
  await listener.close();
  await core.close();
});

/** A message to review a pull request, to scout by id, with a key of its own unless told otherwise. */
function aReview(overrides: Partial<MessageToSend> = {}): MessageToSend {
  return {
    selector: { kind: 'ship', shipId: scoutId },
    payload: '{"review":"https://github.com/ThomasHendrickx/aeolus-fleet/pull/22"}',
    contentType: 'application/json',
    idempotencyKey: `review-${newId('message')}`,
    ...overrides,
  };
}

function sendMessageWith(uow: UnitOfWork<PrismaTx>) {
  return createSendMessage({ uow, clock: core.clock, ids: newId, hasher: sha256Hasher });
}

/**
 * The Prisma unit of work with a step of the send wrapped: `wrap` gets the
 * transaction's ports and returns them with that step changed.
 */
function unitOfWorkWith(wrap: (tx: PrismaTx) => PrismaTx): UnitOfWork<PrismaTx> {
  const uow = createPrismaUnitOfWork(core.prisma);
  return { run: (work) => uow.run((tx) => work(wrap(tx))) };
}

/**
 * Sends a message from scout to argo that commits, and waits for its notice.
 * Postgres hands one listener its notices in commit order, so once this one
 * arrives, every notice of a transaction that committed before it has too.
 */
async function probe(): Promise<void> {
  const { messageId } = unwrap(await core.useCases.sendMessage(scout, aReview({ selector: { kind: 'ship', name: 'argo' } })));
  const delivery = await core.prisma.delivery.findFirstOrThrow({ where: { messageId } });
  await vi.waitFor(() => {
    expect(notices.map((notice) => notice.deliveryId)).toContain(delivery.id);
  });
}

async function storedCounts() {
  return {
    messages: await core.prisma.message.count(),
    deliveries: await core.prisma.delivery.count(),
    accepted: await core.prisma.event.count({ where: { type: 'MessageAccepted' } }),
  };
}

describe('sending a message on Postgres', () => {
  it('stores the message and its pending delivery, writes MessageAccepted, and notifies after commit', async () => {
    const input = aReview();

    const { messageId } = unwrap(await core.useCases.sendMessage(argo, input));

    const [stored] = await core.prisma.message.findMany();
    expect(stored?.requestHash).toMatch(/^[0-9a-f]{64}$/);
    await expect(core.prisma.message.findMany()).resolves.toEqual([
      {
        id: messageId,
        fleetId,
        senderShipId: argoId,
        selectorKind: 'ship',
        selectorShipId: scoutId,
        selectorType: null,
        payload: input.payload,
        contentType: 'application/json',
        idempotencyKey: input.idempotencyKey,
        requestHash: stored?.requestHash,
        inReplyToMessageId: null,
        resendOfMessageId: null,
        createdAt: core.clock.now(),
      },
    ]);
    const [delivery] = await core.prisma.delivery.findMany();
    expect(delivery?.id).toMatch(/^dlv_/);
    expect(delivery).toEqual({
      id: delivery?.id,
      fleetId,
      messageId,
      recipientShipId: scoutId,
      recipientType: null,
      state: 'pending',
      claimedByShipId: null,
      attempts: 0,
      readAt: null,
      createdAt: core.clock.now(),
    });
    await expect(core.prisma.event.findMany({ where: { type: 'MessageAccepted' } })).resolves.toEqual([
      expect.objectContaining({
        fleetId,
        occurredAt: core.clock.now(),
        actorShipId: argoId,
        shipId: scoutId,
        messageId,
        deliveryId: delivery?.id,
        details: { selector: 'ship', recipientType: null },
      }),
    ]);
    await vi.waitFor(() => {
      expect(notices).toEqual([{ fleetId, deliveryId: delivery?.id, recipient: { kind: 'ship', shipId: scoutId } }]);
    });
  });

  it('stores the content type exactly as sent', async () => {
    const contentType = 'application/vnd.aeolus.review+json; charset="UTF-8"';

    const { messageId } = unwrap(await core.useCases.sendMessage(argo, aReview({ contentType })));

    await expect(core.prisma.message.findUniqueOrThrow({ where: { id: messageId } })).resolves.toMatchObject({
      contentType,
    });
  });

  it("resolves a name to the ship's id, and a type to its queue", async () => {
    unwrap(await core.useCases.sendMessage(scout, aReview({ selector: { kind: 'ship', name: 'argo' } })));
    unwrap(await core.useCases.sendMessage(argo, aReview({ selector: { kind: 'type', type: 'reviewer' } })));

    const stored = await core.prisma.delivery.findMany({ orderBy: { id: 'asc' }, include: { message: true } });
    expect(
      stored.map((delivery) => [
        delivery.message.selectorKind,
        delivery.message.selectorShipId,
        delivery.message.selectorType,
        delivery.recipientShipId,
        delivery.recipientType,
      ]),
    ).toEqual([
      ['ship', argoId, null, argoId, null],
      ['type', null, 'reviewer', null, 'reviewer'],
    ]);
  });

  it('refuses a retired ship by id and by name, and a type whose ships are all retired', async () => {
    await core.prisma.ship.update({ where: { id: scoutId }, data: { retiredAt: core.clock.now() } });

    for (const selector of [
      { kind: 'ship', shipId: scoutId },
      { kind: 'ship', name: 'scout' },
      { kind: 'type', type: 'reviewer' },
    ] as const) {
      await expect(core.useCases.sendMessage(argo, aReview({ selector }))).resolves.toMatchObject({
        isOk: false,
        error: { kind: 'UNRESOLVABLE_SELECTOR' },
      });
    }
    await expect(storedCounts()).resolves.toEqual({ messages: 0, deliveries: 0, accepted: 0 });
  });

  it("stores the message a reply names, and refuses one of another fleet's", async () => {
    const question = unwrap(
      await core.useCases.sendMessage(scout, aReview({ selector: { kind: 'ship', name: 'argo' } })),
    ).messageId;
    const elsewhere = newId('message');
    const otherFleetId = newId('fleet');
    const stranger = newId('ship');
    await core.prisma.fleet.create({ data: { id: otherFleetId, name: 'other fleet', createdAt: core.clock.now() } });
    await core.prisma.ship.create({
      data: { id: stranger, fleetId: otherFleetId, name: 'stranger', type: 'reviewer', kind: 'agent', scopes: [], createdAt: core.clock.now() },
    });
    await core.prisma.message.create({
      data: {
        id: elsewhere,
        fleetId: otherFleetId,
        senderShipId: stranger,
        selectorKind: 'type',
        selectorType: 'reviewer',
        payload: 'elsewhere',
        contentType: 'text/plain',
        idempotencyKey: 'elsewhere',
        requestHash: 'elsewhere',
        createdAt: core.clock.now(),
      },
    });

    const answer = unwrap(await core.useCases.sendMessage(argo, aReview({ inReplyTo: question }))).messageId;

    await expect(core.prisma.message.findUniqueOrThrow({ where: { id: answer } })).resolves.toMatchObject({
      inReplyToMessageId: question,
    });
    await expect(core.useCases.sendMessage(argo, aReview({ inReplyTo: elsewhere }))).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'IN_REPLY_TO_NOT_FOUND' },
    });
  });

  it('returns the original message id for a repeat of the same request, and stores nothing new', async () => {
    const input = aReview();
    const { messageId } = unwrap(await core.useCases.sendMessage(argo, input));

    await expect(core.useCases.sendMessage(argo, { ...input })).resolves.toEqual({ isOk: true, value: { messageId } });
    await expect(storedCounts()).resolves.toEqual({ messages: 1, deliveries: 1, accepted: 1 });
  });

  it('refuses the same key with another request, and stores nothing new', async () => {
    const input = aReview();
    unwrap(await core.useCases.sendMessage(argo, input));

    await expect(core.useCases.sendMessage(argo, { ...input, payload: 'something else' })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'IDEMPOTENCY_KEY_REUSED' },
    });
    await expect(storedCounts()).resolves.toEqual({ messages: 1, deliveries: 1, accepted: 1 });
  });
});

describe('a send that fails', () => {
  it.each([
    {
      label: 'right after the message insert',
      wrap: (tx: PrismaTx): PrismaTx => ({
        ...tx,
        deliveries: { create: () => Promise.reject(new Error('disk full')) },
      }),
    },
    {
      label: 'after its notice was queued',
      wrap: (tx: PrismaTx): PrismaTx => ({
        ...tx,
        notifier: {
          deliveryPending: async (notice) => {
            await tx.notifier.deliveryPending(notice);
            throw new Error('disk full');
          },
        },
      }),
    },
  ])('$label leaves no message, no delivery and no event, and wakes nobody', async ({ wrap }) => {
    const sendMessage = sendMessageWith(unitOfWorkWith(wrap));

    await expect(sendMessage(argo, aReview())).rejects.toThrow('disk full');

    await expect(storedCounts()).resolves.toEqual({ messages: 0, deliveries: 0, accepted: 0 });
    await probe();
    expect(notices).toHaveLength(1);
    expect(notices[0]?.recipient).toEqual({ kind: 'ship', shipId: argoId });
  });
});

describe('the notice of a send', () => {
  it('reaches a listener only once the send commits, never while it is open', async () => {
    const queued = Promise.withResolvers<undefined>();
    const commit = Promise.withResolvers<undefined>();
    const sendMessage = sendMessageWith(
      unitOfWorkWith((tx) => ({
        ...tx,
        notifier: {
          deliveryPending: async (notice) => {
            await tx.notifier.deliveryPending(notice);
            queued.resolve(undefined);
            await commit.promise;
          },
        },
      })),
    );

    const sending = sendMessage(argo, aReview());
    await queued.promise;
    await probe();
    const whileOpen = notices.map((notice) => notice.recipient);
    commit.resolve(undefined);
    unwrap(await sending);

    expect(whileOpen).toEqual([{ kind: 'ship', shipId: argoId }]);
    await vi.waitFor(() => {
      expect(notices.map((notice) => notice.recipient)).toEqual([
        { kind: 'ship', shipId: argoId },
        { kind: 'ship', shipId: scoutId },
      ]);
    });
  });
});

describe('concurrent sends with one idempotency key', () => {
  it('store one message: every send gets its id', async () => {
    const sendMessage = sendMessageWith(
      racingUnitOfWork({ prisma: core.prisma, transactions: 5 }, (tx, allArrived) => ({
        ...tx,
        messages: {
          ...tx.messages,
          findByIdempotencyKey: async (key) => {
            await allArrived();
            return tx.messages.findByIdempotencyKey(key);
          },
        },
      })),
    );
    const input = aReview();

    const results = await Promise.all(Array.from({ length: 5 }, () => sendMessage(argo, input)));

    const [message] = await core.prisma.message.findMany();
    expect(results).toEqual(Array.from({ length: 5 }, () => ({ isOk: true, value: { messageId: message?.id } })));
    await expect(storedCounts()).resolves.toEqual({ messages: 1, deliveries: 1, accepted: 1 });
  });
});

describe('concurrent sends of two requests with one idempotency key', () => {
  it('store one message: the sends of its request get its id, the others are refused', async () => {
    const sendMessage = sendMessageWith(
      racingUnitOfWork({ prisma: core.prisma, transactions: 4 }, (tx, allArrived) => ({
        ...tx,
        messages: {
          ...tx.messages,
          findByIdempotencyKey: async (key) => {
            await allArrived();
            return tx.messages.findByIdempotencyKey(key);
          },
        },
      })),
    );
    const one = aReview({ payload: 'one' });
    const inputs = [one, { ...one, payload: 'other' }, one, { ...one, payload: 'other' }];

    const results = await Promise.all(inputs.map((input) => sendMessage(argo, input)));

    const [message] = await core.prisma.message.findMany();
    expect(results).toEqual(
      inputs.map((input) =>
        input.payload === message?.payload
          ? { isOk: true, value: { messageId: message.id } }
          : { isOk: false, error: { kind: 'IDEMPOTENCY_KEY_REUSED', message: KEY_REUSED } },
      ),
    );
    await expect(storedCounts()).resolves.toEqual({ messages: 1, deliveries: 1, accepted: 1 });
  });
});

describe('the payload limit on Postgres', () => {
  it.each([
    { label: 'one-byte characters', payload: 'a'.repeat(65_536) },
    { label: 'two-byte characters', payload: 'é'.repeat(32_768) },
  ])('accepts exactly 64 KB of $label and stores every byte', async ({ payload }) => {
    const { messageId } = unwrap(await core.useCases.sendMessage(argo, aReview({ payload })));

    const [stored] = await core.prisma.$queryRaw<{ bytes: number; payload: string }[]>`
      SELECT octet_length(payload) AS bytes, payload FROM messages WHERE id = ${messageId}`;
    expect(stored).toEqual({ bytes: 65_536, payload });
  });

  it.each([
    { label: 'one-byte characters', payload: 'a'.repeat(65_537) },
    { label: 'two-byte characters and one more byte', payload: `${'é'.repeat(32_768)}a` },
  ])('refuses one byte over 64 KB in $label, and stores nothing', async ({ payload }) => {
    await expect(core.useCases.sendMessage(argo, aReview({ payload }))).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'PAYLOAD_TOO_LARGE' },
    });
    await expect(storedCounts()).resolves.toEqual({ messages: 0, deliveries: 0, accepted: 0 });
  });
});

describe('a send and a retire of the ship it addresses', () => {
  const byIdAndByName = [
    { label: 'by id', selector: () => ({ kind: 'ship', shipId: scoutId }) as const },
    { label: 'by name', selector: () => ({ kind: 'ship', name: 'scout' }) as const },
  ];

  /** Sessions of this database that wait for a lock another transaction holds. */
  async function sessionsWaitingForALock(): Promise<number> {
    const [row] = await core.prisma.$queryRaw<{ waiting: number }[]>`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    return row?.waiting ?? 0;
  }

  it.each(byIdAndByName)('keep a retire from locking the ship while a send $label is open', async ({ selector }) => {
    const queued = Promise.withResolvers<undefined>();
    const commit = Promise.withResolvers<undefined>();
    const sendMessage = sendMessageWith(
      unitOfWorkWith((tx) => ({
        ...tx,
        notifier: {
          deliveryPending: async (notice) => {
            await tx.notifier.deliveryPending(notice);
            queued.resolve(undefined);
            await commit.promise;
          },
        },
      })),
    );

    const sending = sendMessage(argo, aReview({ selector: selector() }));
    await queued.promise;
    const retireLock = core.prisma.$queryRaw`SELECT id FROM ships WHERE id = ${scoutId} FOR NO KEY UPDATE NOWAIT`;
    await expect(retireLock).rejects.toThrow(/could not obtain lock/);
    commit.resolve(undefined);

    await expect(sending).resolves.toMatchObject({ isOk: true });
  });

  it.each(byIdAndByName)(
    'make a send $label wait for a retire holding the ship, then refuse the retired ship',
    async ({ selector }) => {
      let sending: ReturnType<typeof core.useCases.sendMessage> | undefined;

      await core.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM ships WHERE id = ${scoutId} FOR NO KEY UPDATE`;
          sending = core.useCases.sendMessage(argo, aReview({ selector: selector() }));
          await vi.waitFor(async () => {
            expect(await sessionsWaitingForALock()).toBe(1);
          });
          await tx.ship.update({ where: { id: scoutId }, data: { retiredAt: core.clock.now() } });
        },
        { timeout: 15_000 },
      );

      await expect(sending).resolves.toMatchObject({ isOk: false, error: { kind: 'UNRESOLVABLE_SELECTOR' } });
      await expect(storedCounts()).resolves.toEqual({ messages: 0, deliveries: 0, accepted: 0 });
    },
  );
});
