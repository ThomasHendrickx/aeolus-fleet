import type { DeliveryId, FleetId, MessageId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { crewAboard, deliveryIdOf, initialiseFleet, messagingUseCases, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';
import type { Caller, Crew } from '../shared/caller.js';
import { createReceiveReply } from './receive-reply.js';

let core: InMemoryCore;
let useCases: ReturnType<typeof messagingUseCases>;
let receiveReply: ReturnType<typeof createReceiveReply>;
let fleetId: FleetId;
let argo: Caller;
let scoutId: ShipId;
let scout: Crew;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-18T12:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  ({ shipId: scoutId } = unwrap(await registryUseCases(core).commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })));
  scout = crewAboard(core, { fleetId, shipId: scoutId });
  useCases = messagingUseCases(core);
  receiveReply = createReceiveReply({ uow: core.uow, clock: core.clock, ids: core.ids, wakeups: core.wakeups });
  core.clock.advance(60_000);
});

/** Scout asks argo something, and gets the request's message id. */
async function ask(): Promise<MessageId> {
  const { messageId } = unwrap(
    await useCases.sendMessage(scout, { selector: { kind: 'ship', shipId: argo.shipId }, payload: 'Look up account 42', contentType: 'text/plain', model: 'claude-opus-5-5', idempotencyKey: newKey() }),
  );
  return messageId;
}

/** Argo sends scout a message, a reply to `inReplyTo` when given, and gets its delivery's id. */
async function sendScout(inReplyTo?: MessageId): Promise<DeliveryId> {
  core.clock.advance(1_000);
  const { messageId } = unwrap(
    await useCases.sendMessage(argo, {
      selector: { kind: 'ship', shipId: scoutId },
      payload: 'Account 42 is Acme',
      contentType: 'text/plain',
      idempotencyKey: newKey(),
      ...(inReplyTo === undefined ? {} : { inReplyTo }),
    }),
  );
  return deliveryIdOf(core, messageId);
}

async function receiveReplyTo(messageId: MessageId): Promise<DeliveryId[]> {
  const { deliveries } = unwrap(await receiveReply(scout, { messageId }));
  return deliveries.map((delivery) => delivery.deliveryId);
}

function stored(deliveryId: DeliveryId) {
  return core.state.deliveries.find((held) => held.id === deliveryId);
}

describe('receiving the reply to one message', () => {
  it('hands the oldest pending reply to that message, with one attempt, and leaves the newer one pending', async () => {
    const request = await ask();
    const first = await sendScout(request);
    const second = await sendScout(request);

    expect(await receiveReplyTo(request)).toEqual([first]);
    expect(stored(first)).toMatchObject({ state: 'handed', attempts: 1, claimedByLeaseId: scout.leaseId });
    expect(stored(second)).toMatchObject({ state: 'pending', attempts: 0 });
  });

  it('passes over an older delivery that is no reply, or a reply to another message, and leaves them pending', async () => {
    const [request, other] = [await ask(), await ask()];
    const plain = await sendScout();
    const toOther = await sendScout(other);
    const reply = await sendScout(request);

    expect(await receiveReplyTo(request)).toEqual([reply]);
    expect(stored(plain)?.state).toBe('pending');
    expect(stored(toOther)?.state).toBe('pending');
  });

  it("hands the reply with its message, naming the request it answers", async () => {
    const request = await ask();
    const reply = await sendScout(request);

    const { deliveries } = unwrap(await receiveReply(scout, { messageId: request }));

    expect(deliveries).toMatchObject([{ deliveryId: reply, inReplyTo: request, payload: 'Account 42 is Acme', senderName: 'argo', attempts: 1 }]);
  });

  it("hands again a reply in flight with the crew's lease, counting another attempt", async () => {
    const request = await ask();
    const reply = await sendScout(request);
    await receiveReplyTo(request);

    expect(await receiveReplyTo(request)).toEqual([reply]);
    expect(stored(reply)?.attempts).toBe(2);
  });

  it('never hands again a delivery in flight that is no reply to that message', async () => {
    const request = await ask();
    const plain = await sendScout();
    unwrap(await useCases.receiveDeliveries(scout, {}));

    expect(await receiveReplyTo(request)).toEqual([]);
    expect(stored(plain)?.attempts).toBe(1);
  });

  it('hands nothing on a pushed lease: the computer side takes its deliveries (decision 0040)', async () => {
    const request = await ask();
    unwrap(await useCases.pushReceiveDeliveries(scout, {}));
    const reply = await sendScout(request);

    expect(await receiveReplyTo(request)).toEqual([]);
    expect(stored(reply)?.state).toBe('pending');
  });
});

describe('waiting for the reply', () => {
  it('waits about 25 seconds when no reply is there, then returns nothing', async () => {
    const request = await ask();

    expect(await receiveReplyTo(request)).toEqual([]);
    expect(core.wakeups.waits).toEqual([25_000]);
  });

  it('returns the reply sent while it waits, as soon as it is woken', async () => {
    const request = await ask();
    const sent: DeliveryId[] = [];
    core.wakeups.nextWaits.push(async () => {
      sent.push(await sendScout(request));
      return 'woken';
    });

    expect(await receiveReplyTo(request)).toEqual(sent);
  });

  it('waits on when a wake-up brings a delivery that is no reply to that message', async () => {
    const request = await ask();
    core.wakeups.nextWaits.push(async () => {
      core.clock.advance(9_000);
      await sendScout();
      return 'woken';
    });

    expect(await receiveReplyTo(request)).toEqual([]);
    expect(core.wakeups.waits).toEqual([25_000, 15_000]);
  });
});
