import { accountIdSchema, createIdGenerator, idSchema, type DeliveryId, type MessageId, type FleetScope } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createMarkDone } from '../src/domain/messaging/mark-done.js';
import { isCrew, type AccountCaller, type ShipCaller, type Crew } from '../src/domain/shared/caller.js';
import { OPERATOR, operatorCaller, secretOf, modelOf } from './support/core-fixtures.js';
import { createPostgresCore, racingUnitOfWork, type PostgresCore } from './support/postgres-core.js';
import { unwrap } from '../src/testing/result.js';
import { newKey } from '../src/testing/keys.js';
import { withOperatorLogin } from './support/operator-login.js';

// argo's inbox on a real Postgres: the messages to argo, open, done or all,
// read and unread, marked done under the console session's lease, and a
// reply that sends and marks done in one transaction or does neither.

const newId = createIdGenerator();

let core: PostgresCore;
let operator: ShipCaller;
let argo: Crew;
let captain: Crew;

beforeEach(async () => {
  core = await createPostgresCore();
  operator = operatorCaller(unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'home fleet' }))));
  const { shipId, secret } = unwrap(await core.useCases.commissionShip(operator, { idempotencyKey: newKey(), name: 'release-captain', type: 'release' }));
  const { crewToken } = unwrap(await core.useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'DEVICE' }, harness: 'claude-code' }));
  captain = unwrap(await core.useCases.authenticate.byCrewToken(crewToken));
  const { token } = unwrap(await core.useCases.signIn(OPERATOR));
  const use = await core.useCases.authenticate.byConsoleSession(token);
  if (!use || !isCrew(use.caller)) {
    throw new Error('The sign-in started no console session crewing argo');
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

    const all = await core.useCases.readInbox(argo, { filter: 'all' }).then(({ items }) => items);

    expect(all.map((entry) => entry.message.id)).toEqual([newer.messageId, older.messageId]);
    expect(all[0]).toMatchObject({
      state: 'pending',
      readAt,
      doneAt: null,
      message: { sender: { id: captain.shipId, name: 'release-captain' }, payload: 'Promote 2.14?' },
    });
    expect(all[1]).toMatchObject({ state: 'acknowledged', readAt: null, doneAt, repliedWith: null });
    await expect(core.useCases.readInbox(argo, { filter: 'open' }).then(({ items }) => items)).resolves.toEqual([all[0]]);
    await expect(core.useCases.readInbox(argo, { filter: 'done' }).then(({ items }) => items)).resolves.toEqual([all[1]]);
  });

  it("pages the messages to argo newest first, each page after the last page's cursor, keeping to the filter", async () => {
    const oldest = await toArgo('one');
    const done = await toArgo('two');
    unwrap(await core.useCases.markDone(argo, { deliveryId: done.deliveryId }));
    const middle = await toArgo('three');
    const newest = await toArgo('four');
    const read = (cursor?: DeliveryId) => core.useCases.readInbox(argo, { filter: 'open', limit: 2, cursor });

    const first = await read();
    const second = await read(first.nextCursor ?? undefined);

    expect([first, second].map(({ items, nextCursor }) => [items.map((entry) => entry.deliveryId), nextCursor])).toEqual([
      [[newest.deliveryId, middle.deliveryId], middle.deliveryId],
      [[oldest.deliveryId], null],
    ]);
  });

  it('counts the open messages to argo, not those done', async () => {
    await toArgo('one');
    const done = await toArgo('two');
    unwrap(await core.useCases.markDone(argo, { deliveryId: done.deliveryId }));
    await toArgo('three');

    await expect(core.useCases.countOpenInbox(argo)).resolves.toEqual({ open: 2 });
  });

  it('counts for an account only the open messages to argo whose sender its read reach reads', async () => {
    const crewed = async (name: string, scopes: FleetScope[]): Promise<Crew> => {
      const { shipId, secret } = unwrap(await core.useCases.commissionShip(operator, { idempotencyKey: newKey(), name, type: name, scopes }));
      const { crewToken } = unwrap(await core.useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'DEVICE' }, harness: 'claude-code' }));
      return unwrap(await core.useCases.authenticate.byCrewToken(crewToken));
    };
    const networking = await crewed('networking', ['fleet:network']);
    const tester = await crewed('tester', []);
    const group = unwrap(await core.useCases.defineLabel(operator, { key: 'group', values: ['a', 'b'] }));
    const [a, b] = group.values.map((value) => value.id);
    if (a === undefined || b === undefined) {
      throw new Error('the group label has no values a and b');
    }
    unwrap(await core.useCases.assignLabel(operator, { shipId: captain.shipId, valueId: a }));
    unwrap(await core.useCases.assignLabel(operator, { shipId: tester.shipId, valueId: b }));
    const { savedAgainstVersion } = unwrap(
      await core.useCases.saveNetworkRulesDraft(networking, { rules: [{ verb: 'read', from: [a], to: [a] }, { verb: 'send', from: [], to: [] }, { verb: 'manage', from: [], to: [] }] }),
    );
    unwrap(await core.useCases.applyNetworkRules(networking, { version: savedAgainstVersion }));
    const mathilde: AccountCaller = {
      kind: 'account',
      accountId: accountIdSchema.parse('acc-mathilde'),
      fleetId: operator.fleetId,
      scopes: ['fleet:read'],
      groupValues: ['a'],
      personShipId: null,
      throughShipId: null,
    };
    await toArgo('from captain');
    await toArgo('again from captain');
    unwrap(await core.useCases.sendMessage(tester, { ...modelOf(tester), selector: { kind: 'ship', shipId: argo.shipId }, payload: 'from tester', idempotencyKey: newKey() }));

    await expect(core.useCases.countOpenInbox(mathilde)).resolves.toEqual({ open: 2 });
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
      expect.objectContaining({ type: 'DeliveryHanded', actorShipId: argo.shipId }),
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
    await expect(core.useCases.readInbox(argo, { filter: 'done' }).then(({ items }) => items)).resolves.toEqual([
      expect.objectContaining({ deliveryId: asked.deliveryId, repliedWith: messageId }),
    ]);
  });

  it("lists argo's own replies to a message, oldest first, each with its content type and payload", async () => {
    const asked = await toArgo('Promote 2.14?');
    core.clock.advance(1_000);
    const { messageId: first } = unwrap(
      await core.useCases.replyToMessage(argo, { deliveryId: asked.deliveryId, payload: 'go', idempotencyKey: 'go' }),
    );
    const firstAt = core.clock.now();
    core.clock.advance(1_000);
    const { messageId: second } = unwrap(
      await core.useCases.replyToMessage(argo, { deliveryId: asked.deliveryId, payload: 'and thanks', idempotencyKey: 'thanks' }),
    );
    unwrap(
      await core.useCases.sendMessage(captain, {
        ...modelOf(captain),
        selector: { kind: 'ship', shipId: captain.shipId },
        payload: 'a note to self',
        inReplyTo: asked.messageId,
        idempotencyKey: 'self',
      }),
    );

    const [entry] = await core.useCases.readInbox(argo, { filter: 'all' }).then(({ items }) => items);

    expect(entry?.replies).toEqual([
      { id: first, contentType: 'text/plain', payload: 'go', sentAt: firstAt },
      { id: second, contentType: 'text/plain', payload: 'and thanks', sentAt: core.clock.now() },
    ]);
  });

  it('replies with the content type argo gives', async () => {
    const asked = await toArgo('Promote 2.14?');

    const { messageId } = unwrap(
      await core.useCases.replyToMessage(argo, {
        deliveryId: asked.deliveryId,
        payload: '{"go":true}',
        contentType: 'application/vnd.example.answer+json',
        idempotencyKey: 'answer',
      }),
    );

    await expect(core.prisma.message.findUniqueOrThrow({ where: { id: messageId } })).resolves.toMatchObject({
      inReplyToMessageId: asked.messageId,
      contentType: 'application/vnd.example.answer+json',
    });
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
