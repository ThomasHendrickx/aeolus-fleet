import { createIdGenerator, idSchema, type DeliveryId, type MessageId, type ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sha256Hasher } from '../src/adapters/crypto/secrets.js';
import { UNDELIVERABLE_AT_ATTEMPT } from '../src/domain/messaging/delivery.js';
import { createDismissDelivery } from '../src/domain/messaging/dismiss-delivery.js';
import { createResendDelivery } from '../src/domain/messaging/resend-delivery.js';
import { createPrismaUnitOfWork } from '../src/adapters/prisma/unit-of-work.js';
import { createReadReachOf } from '../src/domain/registry/read-reach.js';
import type { ShipCaller, Crew } from '../src/domain/shared/caller.js';
import type { Selector } from '../src/domain/shared/selector.js';
import { operatorCaller, secretOf, modelOf } from './support/core-fixtures.js';
import { createPostgresCore, racingUnitOfWork, type PostgresCore } from './support/postgres-core.js';
import { unwrap } from '../src/testing/result.js';
import { newKey } from '../src/testing/keys.js';
import { withOperatorLogin } from './support/operator-login.js';

// Needs attention on a real Postgres: the undeliverable deliveries listed
// oldest first, a dismiss, and a resend that stores a new message naming the
// original and dismisses it, in one transaction; concurrent resends of one
// delivery store one message.

const newId = createIdGenerator();

let core: PostgresCore;
let argo: ShipCaller;
let scout: Crew;
let planner: Crew;

async function crewed(ship: { name: string; type: string }): Promise<Crew> {
  const { shipId, secret } = unwrap(await core.useCases.commissionShip(argo, { ...ship, idempotencyKey: newKey() }));
  const { crewToken } = unwrap(
    await core.useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'DEVICE' }, harness: 'claude-code' }),
  );
  return unwrap(await core.useCases.authenticate.byCrewToken(crewToken));
}

beforeEach(async () => {
  core = await createPostgresCore();
  argo = operatorCaller(unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'home fleet' }))));
  scout = await crewed({ name: 'scout', type: 'tester' });
  planner = await crewed({ name: 'planner', type: 'planner' });
});

afterEach(async () => {
  await core.close();
});

async function sendTo(selector: Selector, payload = '{"run":"e2e","ref":"pr-320"}'): Promise<MessageId> {
  core.clock.advance(1_000);
  return unwrap(
    await core.useCases.sendMessage(planner, { ...modelOf(planner),
      selector,
      payload,
      contentType: 'application/json',
      idempotencyKey: `key-${newId('message')}`,
    }),
  ).messageId;
}

async function deliveryOf(messageId: MessageId): Promise<DeliveryId> {
  const { id } = await core.prisma.delivery.findFirstOrThrow({ where: { messageId } });
  return idSchema('delivery').parse(id);
}

/**
 * A message to scout that its crew receives five times without acknowledging
 * it: undeliverable. A second message waits behind it, so the fifth receive
 * hands that one out instead of waiting on an empty inbox.
 */
async function undeliverable(): Promise<{ messageId: MessageId; deliveryId: DeliveryId }> {
  const messageId = await sendTo({ kind: 'ship', shipId: scout.shipId });
  const next = await sendTo({ kind: 'ship', shipId: scout.shipId }, 'next');
  for (let claim = 1; claim <= UNDELIVERABLE_AT_ATTEMPT; claim += 1) {
    core.clock.advance(1_000);
    unwrap(await core.useCases.receiveDeliveries(scout, {}));
  }
  unwrap(await core.useCases.acknowledgeDelivery(scout, { deliveryId: await deliveryOf(next) }));
  return { messageId, deliveryId: await deliveryOf(messageId) };
}

function stored(deliveryId: DeliveryId) {
  return core.prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } });
}

/**
 * A message to scout that its pushed crew takes, hands over and confirms,
 * hands once more after the turn died, and reports not handled when that turn
 * died too. Answers when it was reported not handled.
 */
async function notHandled(reason?: string): Promise<{ messageId: MessageId; deliveryId: DeliveryId; at: Date }> {
  const messageId = await sendTo({ kind: 'ship', shipId: scout.shipId });
  const deliveryId = await deliveryOf(messageId);
  unwrap(await core.useCases.pushReceiveDeliveries(scout, {}));
  unwrap(await core.useCases.handOverDelivery(scout, { deliveryId, handOverNumber: 1 }));
  unwrap(await core.useCases.acknowledgeDelivery(scout, { deliveryId }));
  unwrap(await core.useCases.handOverDelivery(scout, { deliveryId, handOverNumber: 2, isOnceMore: true }));
  core.clock.advance(1_000);
  unwrap(await core.useCases.reportNotHandled(scout, reason === undefined ? { deliveryId } : { deliveryId, reason }));
  return { messageId, deliveryId, at: core.clock.now() };
}

describe('Needs attention on Postgres', () => {
  it('lists the undeliverable deliveries oldest first, each with its whole message and since when', async () => {
    const first = await undeliverable();
    const since = core.clock.now();
    const second = await undeliverable();

    const listed = await core.useCases.readNeedsAttention(argo, {}).then(({ items }) => items);

    expect(listed.map((entry) => entry.deliveryId)).toEqual([first.deliveryId, second.deliveryId]);
    expect(listed[0]).toEqual({
      deliveryId: first.deliveryId,
      state: 'undeliverable',
      attempts: UNDELIVERABLE_AT_ATTEMPT,
      isPushed: false,
      since,
      reason: null,
      ship: { id: scout.shipId, name: 'scout' },
      message: {
        id: first.messageId,
        sender: { id: planner.shipId, name: 'planner' },
        recipient: { kind: 'ship', ship: { id: scout.shipId, name: 'scout' } },
        inReplyTo: null,
        sentAt: new Date(since.getTime() - UNDELIVERABLE_AT_ATTEMPT * 1_000 - 1_000),
        contentType: 'application/json',
        isPing: false,
        model: 'claude-opus-5-5',
        payload: '{"run":"e2e","ref":"pr-320"}',
      },
    });
    await expect(core.useCases.readNeedsAttention({ ...argo, fleetId: newId('fleet') }, {}).then(({ items }) => items)).resolves.toEqual([]);
  });

  it("pages oldest first by its cursor, even after the cursor's delivery was dismissed, a ship's page holding only its own", async () => {
    const first = await undeliverable();
    const second = await notHandled();
    const third = await undeliverable();
    const read = (input: { shipId?: ShipId; cursor?: DeliveryId; limit?: number }) => core.useCases.readNeedsAttention(argo, input);
    const page = await read({ limit: 1 });
    unwrap(await core.useCases.dismissDelivery(argo, { deliveryId: first.deliveryId }));

    const next = await read({ limit: 1, cursor: page.nextCursor ?? undefined });
    const last = await read({ limit: 5, cursor: next.nextCursor ?? undefined });

    expect([page, next, last].map(({ items, nextCursor }) => [items.map((entry) => entry.deliveryId), nextCursor])).toEqual([
      [[first.deliveryId], first.deliveryId],
      [[second.deliveryId], second.deliveryId],
      [[third.deliveryId], null],
    ]);
    expect([(await read({ shipId: scout.shipId })).items.length, (await read({ shipId: planner.shipId })).items.length]).toEqual([2, 0]);
  });

  it('tells an undeliverable delivery a pushed crew handed over again and again', async () => {
    const messageId = await sendTo({ kind: 'ship', shipId: scout.shipId });
    const deliveryId = await deliveryOf(messageId);
    unwrap(await core.useCases.pushReceiveDeliveries(scout, {}));
    for (let handOverNumber = 1; handOverNumber <= UNDELIVERABLE_AT_ATTEMPT; handOverNumber += 1) {
      unwrap(await core.useCases.handOverDelivery(scout, { deliveryId, handOverNumber }));
    }

    await expect(core.useCases.readNeedsAttention(argo, {}).then(({ items }) => items)).resolves.toMatchObject([{ deliveryId, state: 'undeliverable', isPushed: true }]);
  });

  it('lists a delivery not handled with the reason its crew gave, stored with DeliveryNotHandled (#847)', async () => {
    const { deliveryId } = await notHandled('the turn it was handed once more to died too');

    await expect(core.useCases.readNeedsAttention(argo, {}).then(({ items }) => items)).resolves.toMatchObject([
      { deliveryId, state: 'notHandled', reason: 'the turn it was handed once more to died too' },
    ]);
  });

  it('lists a delivery not handled with the undeliverable ones, by since when, and dismisses and resends it as one', async () => {
    const undeliverableOne = await undeliverable();
    const dismissed = await notHandled();
    const resent = await notHandled();

    const listed = await core.useCases.readNeedsAttention(argo, {}).then(({ items }) => items);

    expect(listed.map(({ deliveryId, state, attempts }) => ({ deliveryId, state, attempts }))).toEqual([
      { deliveryId: undeliverableOne.deliveryId, state: 'undeliverable', attempts: UNDELIVERABLE_AT_ATTEMPT },
      { deliveryId: dismissed.deliveryId, state: 'notHandled', attempts: 1 },
      { deliveryId: resent.deliveryId, state: 'notHandled', attempts: 1 },
    ]);
    expect(listed[1]?.since).toEqual(dismissed.at);

    unwrap(await core.useCases.dismissDelivery(argo, { deliveryId: dismissed.deliveryId }));
    const { messageId } = unwrap(await core.useCases.resendDelivery(argo, { deliveryId: resent.deliveryId }));

    await expect(stored(dismissed.deliveryId)).resolves.toMatchObject({ state: 'dismissed' });
    await expect(stored(resent.deliveryId)).resolves.toMatchObject({ state: 'dismissed' });
    await expect(core.prisma.message.findUniqueOrThrow({ where: { id: messageId } })).resolves.toMatchObject({
      resendOfMessageId: resent.messageId,
    });
    await expect(core.useCases.readNeedsAttention(argo, {}).then(({ items }) => items)).resolves.toMatchObject([{ deliveryId: undeliverableOne.deliveryId }]);
  });

  it('dismisses one: dismissed, with DeliveryDismissed caused by argo, and gone from the list', async () => {
    const { messageId, deliveryId } = await undeliverable();

    unwrap(await core.useCases.dismissDelivery(argo, { deliveryId }));

    await expect(stored(deliveryId)).resolves.toMatchObject({ state: 'dismissed', attempts: UNDELIVERABLE_AT_ATTEMPT });
    await expect(core.prisma.event.findMany({ where: { type: 'DeliveryDismissed' } })).resolves.toEqual([
      expect.objectContaining({ actorShipId: argo.shipId, shipId: scout.shipId, messageId, deliveryId }),
    ]);
    await expect(core.useCases.readNeedsAttention(argo, {}).then(({ items }) => items)).resolves.toEqual([]);
  });

  it('resends one: a new message from its sender naming the original, pending for the same ship; the original dismissed', async () => {
    const original = await undeliverable();

    const { messageId } = unwrap(await core.useCases.resendDelivery(argo, { deliveryId: original.deliveryId }));

    await expect(core.prisma.message.findUniqueOrThrow({ where: { id: messageId } })).resolves.toMatchObject({
      senderShipId: planner.shipId,
      selectorShipId: scout.shipId,
      payload: '{"run":"e2e","ref":"pr-320"}',
      contentType: 'application/json',
      resendOfMessageId: original.messageId,
    });
    await expect(core.prisma.delivery.findFirstOrThrow({ where: { messageId } })).resolves.toMatchObject({
      recipientShipId: scout.shipId,
      state: 'pending',
      attempts: 0,
    });
    await expect(stored(original.deliveryId)).resolves.toMatchObject({ state: 'dismissed' });
    await expect(
      core.prisma.event.findMany({
        where: { OR: [{ messageId }, { type: 'DeliveryDismissed' }] },
        orderBy: { seq: 'asc' },
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        type: 'MessageAccepted',
        actorShipId: argo.shipId,
        details: { selector: 'ship', recipientType: null, model: 'claude-opus-5-5', resendOf: original.messageId },
      }),
      expect.objectContaining({ type: 'DeliveryDismissed', actorShipId: argo.shipId, deliveryId: original.deliveryId }),
    ]);
    await expect(core.useCases.readNeedsAttention(argo, {}).then(({ items }) => items)).resolves.toEqual([]);
  });

  it('refuses to resend to a retired ship, and keeps the original undeliverable with nothing stored', async () => {
    const original = await undeliverable();
    unwrap(await core.useCases.retireShip(argo, { shipId: scout.shipId }));
    const messages = await core.prisma.message.count();

    await expect(core.useCases.resendDelivery(argo, { deliveryId: original.deliveryId })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'UNRESOLVABLE_SELECTOR' },
    });
    await expect(stored(original.deliveryId)).resolves.toMatchObject({ state: 'undeliverable' });
    await expect(core.prisma.message.count()).resolves.toBe(messages);
  });

  it('gives three concurrent resends of one delivery one new message, which each of them answers', async () => {
    const original = await undeliverable();
    const messages = await core.prisma.message.count();
    const resendDelivery = createResendDelivery({
      readReach: readReachOn(core),
      uow: racingUnitOfWork({ prisma: core.prisma, transactions: 3 }, (tx, allArrived) => ({
        ...tx,
        deliveries: {
          ...tx.deliveries,
          findForUpdate: async (fleetId, deliveryId) => {
            await allArrived();
            return tx.deliveries.findForUpdate(fleetId, deliveryId);
          },
        },
      })),
      clock: core.clock,
      ids: newId,
      hasher: sha256Hasher,
    });

    const results = await Promise.all(
      Array.from({ length: 3 }, () => resendDelivery(argo, { deliveryId: original.deliveryId })),
    );

    const answered = new Set(results.map((result) => unwrap(result).messageId));
    expect(answered.size).toBe(1);
    await expect(core.prisma.message.count()).resolves.toBe(messages + 1);
    await expect(core.prisma.event.count({ where: { type: 'DeliveryDismissed' } })).resolves.toBe(1);
  });

  it('lets a dismiss and a resend racing for one delivery take turns: it is dismissed once and resent at most once', async () => {
    const original = await undeliverable();
    const racing = racingUnitOfWork({ prisma: core.prisma, transactions: 2 }, (tx, allArrived) => ({
      ...tx,
      deliveries: {
        ...tx.deliveries,
        findForUpdate: async (fleetId, deliveryId) => {
          await allArrived();
          return tx.deliveries.findForUpdate(fleetId, deliveryId);
        },
      },
    }));
    const deps = { uow: racing, clock: core.clock, ids: newId, readReach: readReachOn(core) };

    const [dismissed, resent] = await Promise.all([
      createDismissDelivery(deps)(argo, { deliveryId: original.deliveryId }),
      createResendDelivery({ ...deps, hasher: sha256Hasher })(argo, { deliveryId: original.deliveryId }),
    ]);

    const outcome = [dismissed.isOk ? 'dismissed' : dismissed.error.kind, resent.isOk ? 'resent' : resent.error.kind];
    expect([['dismissed', 'DELIVERY_NOT_UNDELIVERABLE'], ['dismissed', 'resent']]).toContainEqual(outcome);
    await expect(stored(original.deliveryId)).resolves.toMatchObject({ state: 'dismissed' });
    await expect(core.prisma.event.count({ where: { type: 'DeliveryDismissed' } })).resolves.toBe(1);
  });
});

/** Read reach worked out in its own unit of work, outside the racing ones. */
function readReachOn(core: PostgresCore) {
  return createReadReachOf({ uow: createPrismaUnitOfWork(core.prisma) });
}
