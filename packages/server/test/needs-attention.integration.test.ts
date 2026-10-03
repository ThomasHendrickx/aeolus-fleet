import { createIdGenerator, idSchema, type DeliveryId, type MessageId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sha256Hasher } from '../src/adapters/crypto/secrets.js';
import { UNDELIVERABLE_AT_CLAIM } from '../src/core/messaging/delivery.js';
import { createDismissDelivery } from '../src/core/messaging/dismiss-delivery.js';
import { createResendDelivery } from '../src/core/messaging/resend-delivery.js';
import type { Caller, Crew } from '../src/core/shared/caller.js';
import type { Selector } from '../src/core/shared/selector.js';
import { OPERATOR, operatorCaller, secretIn } from './support/core-fixtures.js';
import { createPostgresCore, racingUnitOfWork, type PostgresCore } from './support/postgres-core.js';
import { unwrap } from './support/result.js';
import { newKey } from './support/keys.js';

// Needs attention on a real Postgres: the undeliverable deliveries listed
// oldest first, a dismiss, and a resend that stores a new message naming the
// original and dismisses it, in one transaction; concurrent resends of one
// delivery store one message.

const newId = createIdGenerator();

let core: PostgresCore;
let argo: Caller;
let scout: Crew;
let planner: Crew;

async function crewed(ship: { name: string; type: string }): Promise<Crew> {
  const { shipId, prompt } = unwrap(await core.useCases.commissionShip(argo, { ...ship, idempotencyKey: newKey() }));
  const { crewToken } = unwrap(
    await core.useCases.claimShip({ shipId, secret: secretIn(prompt), location: { kind: 'DEVICE' } }),
  );
  return unwrap(await core.useCases.authenticate.byCrewToken(crewToken));
}

beforeEach(async () => {
  core = await createPostgresCore();
  argo = operatorCaller(unwrap(await core.useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR })));
  scout = await crewed({ name: 'scout', type: 'tester' });
  planner = await crewed({ name: 'planner', type: 'planner' });
});

afterEach(async () => {
  await core.close();
});

async function sendTo(selector: Selector, payload = '{"run":"e2e","ref":"pr-320"}'): Promise<MessageId> {
  core.clock.advance(1_000);
  return unwrap(
    await core.useCases.sendMessage(planner, {
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
  for (let claim = 1; claim <= UNDELIVERABLE_AT_CLAIM; claim += 1) {
    core.clock.advance(1_000);
    unwrap(await core.useCases.receiveDeliveries(scout, {}));
  }
  unwrap(await core.useCases.acknowledgeDelivery(scout, { deliveryId: await deliveryOf(next) }));
  return { messageId, deliveryId: await deliveryOf(messageId) };
}

function stored(deliveryId: DeliveryId) {
  return core.prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } });
}

describe('Needs attention on Postgres', () => {
  it('lists the undeliverable deliveries oldest first, each with its whole message and since when', async () => {
    const first = await undeliverable();
    const since = core.clock.now();
    const second = await undeliverable();

    const listed = await core.useCases.readNeedsAttention(argo);

    expect(listed.map((entry) => entry.deliveryId)).toEqual([first.deliveryId, second.deliveryId]);
    expect(listed[0]).toEqual({
      deliveryId: first.deliveryId,
      attempts: UNDELIVERABLE_AT_CLAIM,
      since,
      message: {
        id: first.messageId,
        sender: { id: planner.shipId, name: 'planner' },
        recipient: { kind: 'ship', ship: { id: scout.shipId, name: 'scout' } },
        inReplyTo: null,
        sentAt: new Date(since.getTime() - UNDELIVERABLE_AT_CLAIM * 1_000 - 1_000),
        contentType: 'application/json',
        payload: '{"run":"e2e","ref":"pr-320"}',
      },
    });
    await expect(core.useCases.readNeedsAttention({ ...argo, fleetId: newId('fleet') })).resolves.toEqual([]);
  });

  it('dismisses one: dismissed, with DeliveryDismissed caused by argo, and gone from the list', async () => {
    const { messageId, deliveryId } = await undeliverable();

    unwrap(await core.useCases.dismissDelivery(argo, { deliveryId }));

    await expect(stored(deliveryId)).resolves.toMatchObject({ state: 'dismissed', attempts: UNDELIVERABLE_AT_CLAIM });
    await expect(core.prisma.event.findMany({ where: { type: 'DeliveryDismissed' } })).resolves.toEqual([
      expect.objectContaining({ actorShipId: argo.shipId, shipId: scout.shipId, messageId, deliveryId }),
    ]);
    await expect(core.useCases.readNeedsAttention(argo)).resolves.toEqual([]);
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
        details: { selector: 'ship', recipientType: null, resendOf: original.messageId },
      }),
      expect.objectContaining({ type: 'DeliveryDismissed', actorShipId: argo.shipId, deliveryId: original.deliveryId }),
    ]);
    await expect(core.useCases.readNeedsAttention(argo)).resolves.toEqual([]);
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
    const deps = { uow: racing, clock: core.clock, ids: newId };

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
