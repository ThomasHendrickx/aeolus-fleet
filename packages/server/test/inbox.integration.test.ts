import { createIdGenerator, idSchema, type DeliveryId, type MessageId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createMarkDone } from '../src/core/messaging/mark-done.js';
import type { Caller, Crew } from '../src/core/shared/caller.js';
import { OPERATOR, operatorCaller, secretIn, modelOf } from './support/core-fixtures.js';
import { createPostgresCore, racingUnitOfWork, type PostgresCore } from './support/postgres-core.js';
import { unwrap } from './support/result.js';
import { newKey } from './support/keys.js';

// argo's inbox on a real Postgres: the messages to argo, open, done or all,
// read and unread, marked done under the console session's lease, and a
// reply that sends and marks done in one transaction or does neither.

const newId = createIdGenerator();

let core: PostgresCore;
let operator: Caller;
let argo: Crew;
let captain: Crew;

beforeEach(async () => {
  core = await createPostgresCore();
  operator = operatorCaller(unwrap(await core.useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR })));
  const { shipId, prompt } = unwrap(await core.useCases.commissionShip(operator, { idempotencyKey: newKey(), name: 'release-captain', type: 'release' }));
  const { crewToken } = unwrap(await core.useCases.claimShip({ shipId, secret: secretIn(prompt), location: { kind: 'DEVICE' }, harness: 'claude-code' }));
  captain = unwrap(await core.useCases.authenticate.byCrewToken(crewToken));
  const { token } = unwrap(await core.useCases.signIn(OPERATOR));
  const use = await core.useCases.authenticate.byConsoleSession(token);
  if (!use) {
    throw new Error('The sign-in started no console session');
  }
  argo = use.caller;
});

afterEach(async () => {
  await core.close();
});

async function toArgo(payload: string): Promise<{ messageId: MessageId; deliveryId: DeliveryId }> {
  core.clock.advance(1_000);
  const { messageId } = unwrap(
    await core.useCases.sendMessage(captain, { ...modelOf(captain),
      selector: { kind: 'ship', shipId: argo.shipId },
      payload,
      idempotencyKey: `key-${newId('message')}`,
    }),
  );
  const { id } = await core.prisma.delivery.findFirstOrThrow({ where: { messageId } });
  return { messageId, deliveryId: idSchema('delivery').parse(id) };
}

describe("argo's inbox on Postgres", () => {
  it('lists the messages to argo by filter, newest first, with when each was read and done', async () => {
    const older = await toArgo('checkout-e2e failed 3 of 5 runs.');
    const newer = await toArgo('Promote 2.14?');
    core.clock.advance(1_000);
    unwrap(await core.useCases.markRead(argo, { deliveryId: newer.deliveryId, isRead: true }));
    const readAt = core.clock.now();
    core.clock.advance(1_000);
    unwrap(await core.useCases.markDone(argo, { deliveryId: older.deliveryId }));
    const doneAt = core.clock.now();

    const all = await core.useCases.readInbox(argo, { filter: 'all' });

    expect(all.map((entry) => entry.message.id)).toEqual([newer.messageId, older.messageId]);
    expect(all[0]).toMatchObject({
      state: 'pending',
      readAt,
      doneAt: null,
      message: { sender: { id: captain.shipId, name: 'release-captain' }, payload: 'Promote 2.14?' },
    });
    expect(all[1]).toMatchObject({ state: 'acknowledged', readAt: null, doneAt, repliedWith: null });
    await expect(core.useCases.readInbox(argo, { filter: 'open' })).resolves.toEqual([all[0]]);
    await expect(core.useCases.readInbox(argo, { filter: 'done' })).resolves.toEqual([all[1]]);
  });

  it('marks a message unread again, keeping the first read until then', async () => {
    const { deliveryId } = await toArgo('Promote 2.14?');
    unwrap(await core.useCases.markRead(argo, { deliveryId, isRead: true }));
    const first = core.clock.now();
    core.clock.advance(1_000);
    unwrap(await core.useCases.markRead(argo, { deliveryId, isRead: true }));
    await expect(core.prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } })).resolves.toMatchObject({ readAt: first });

    unwrap(await core.useCases.markRead(argo, { deliveryId, isRead: false }));

    await expect(core.prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } })).resolves.toMatchObject({ readAt: null });
  });

  it("marks a message done: claimed and acknowledged under the console session's lease, with both events", async () => {
    const { deliveryId } = await toArgo('Promote 2.14?');

    unwrap(await core.useCases.markDone(argo, { deliveryId }));

    await expect(core.prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } })).resolves.toMatchObject({
      state: 'acknowledged',
      claimedByShipId: argo.shipId,
      claimedByLeaseId: argo.leaseId,
      attempts: 1,
    });
    await expect(
      core.prisma.event.findMany({ where: { deliveryId, type: { not: 'MessageAccepted' } }, orderBy: { seq: 'asc' } }),
    ).resolves.toEqual([
      expect.objectContaining({ type: 'DeliveryClaimed', actorShipId: argo.shipId }),
      expect.objectContaining({ type: 'DeliveryAcknowledged', actorShipId: argo.shipId }),
    ]);
  });

  it('gives three concurrent marks of one message done one claim and one acknowledgement', async () => {
    const { deliveryId } = await toArgo('Promote 2.14?');
    const markDone = createMarkDone({
      uow: racingUnitOfWork({ prisma: core.prisma, transactions: 3 }, (tx, allArrived) => ({
        ...tx,
        deliveries: {
          ...tx.deliveries,
          findForUpdate: async (fleetId, id) => {
            await allArrived();
            return tx.deliveries.findForUpdate(fleetId, id);
          },
        },
      })),
      clock: core.clock,
      ids: newId,
    });

    const results = await Promise.all(Array.from({ length: 3 }, () => markDone(argo, { deliveryId })));

    expect(results.every((result) => result.isOk)).toBe(true);
    await expect(core.prisma.event.count({ where: { deliveryId, type: 'DeliveryAcknowledged' } })).resolves.toBe(1);
    await expect(core.prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } })).resolves.toMatchObject({ attempts: 1 });
  });

  it('replies: the reply to the sender and the message done, its acknowledgement naming the reply', async () => {
    const asked = await toArgo('Promote 2.14?');

    const { messageId } = unwrap(
      await core.useCases.replyToMessage(argo, { deliveryId: asked.deliveryId, payload: 'go', idempotencyKey: 'go' }),
    );

    await expect(core.prisma.message.findUniqueOrThrow({ where: { id: messageId } })).resolves.toMatchObject({
      senderShipId: argo.shipId,
      selectorShipId: captain.shipId,
      inReplyToMessageId: asked.messageId,
      payload: 'go',
    });
    await expect(core.useCases.readInbox(argo, { filter: 'done' })).resolves.toEqual([
      expect.objectContaining({ deliveryId: asked.deliveryId, repliedWith: messageId }),
    ]);
  });

  it('refuses a reply to a retired sender and rolls back: nothing sent, the message still open', async () => {
    const asked = await toArgo('Promote 2.14?');
    unwrap(await core.useCases.retireShip(operator, { shipId: captain.shipId }));
    const messages = await core.prisma.message.count();

    await expect(
      core.useCases.replyToMessage(argo, { deliveryId: asked.deliveryId, payload: 'go', idempotencyKey: 'go' }),
    ).resolves.toMatchObject({ isOk: false, error: { kind: 'UNRESOLVABLE_SELECTOR' } });
    await expect(core.prisma.message.count()).resolves.toBe(messages);
    await expect(core.prisma.delivery.findUniqueOrThrow({ where: { id: asked.deliveryId } })).resolves.toMatchObject({
      state: 'pending',
    });
  });

  it('refuses to mark done once the console session was taken over by a sign-in elsewhere', async () => {
    const { deliveryId } = await toArgo('Promote 2.14?');
    core.clock.advance(60_000);
    unwrap(await core.useCases.signIn(OPERATOR));

    await expect(core.useCases.markDone(argo, { deliveryId })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'LEASE_ENDED' },
    });
  });
});
