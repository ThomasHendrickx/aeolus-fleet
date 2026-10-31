import { WITHDRAWAL_CONTENT_TYPE, type FleetId, type MessageId, type ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { argoAboard, crewAboard, deliveryIdOf, historyUseCases, initialiseFleet, messagingUseCases, modelOf, operatorCaller, registryUseCases, sealFleet } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';
import { DATA_KEY_CACHE_MS } from '../messaging/public.js';
import type { Crew, ShipCaller } from './caller.js';

/**
 * The history reads with a sealed fleet's company key cut off (decision
 * 0068, B9): a read that lists several payloads marks each one it cannot
 * unseal unreadable and lists the rest, and so does a message's page, keeping
 * its envelope and delivery. The fleet stored a payload plain before it was sealed, so
 * one payload in a list still reads.
 */
let core: InMemoryCore;
let messaging: ReturnType<typeof messagingUseCases>;
let history: ReturnType<typeof historyUseCases>;
let fleetId: FleetId;
let operator: ShipCaller;
let argoId: ShipId;
let argo: Crew;
let tester: Crew;
let scout: Crew;

/** The attempt at which a delivery received and never acknowledged becomes undeliverable. */
const UNDELIVERABLE_AT_ATTEMPT = 5;
const PLAIN = 'Sent before the fleet was sealed';
const SEALED = 'Sent after the fleet was sealed, 5 € budget';
const QUESTION_ID = '0f8e2c1a-5b7d-4e3f-9a6b-2c4d8e1f0a3b';
const UNREADABLE = { kind: 'unreadable' };

beforeEach(async () => {
  core = createInMemoryCore('2026-10-29T14:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId, operatorShipId: argoId } = fleet);
  operator = operatorCaller(fleet);
  const registry = registryUseCases(core);
  tester = crewAboard(core, { fleetId, shipId: unwrap(await registry.commissionShip(operator, { idempotencyKey: newKey(), name: 'tester-01', type: 'tester' })).shipId });
  scout = crewAboard(core, { fleetId, shipId: unwrap(await registry.commissionShip(operator, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })).shipId });
  argo = await argoAboard(core);
  messaging = messagingUseCases(core);
  history = historyUseCases(core);
});

async function sentTo(shipId: ShipId, message: { payload: string; contentType?: string }): Promise<MessageId> {
  core.clock.advance(1_000);
  return unwrap(await messaging.sendMessage(tester, { ...modelOf(tester), selector: { kind: 'ship', shipId }, idempotencyKey: newKey(), ...message })).messageId;
}

/** The company disables its key and every server's data key cache runs out. */
async function keyCutOff(companyKey: string): Promise<void> {
  await core.keyVault.disable(companyKey);
  core.clock.advance(DATA_KEY_CACHE_MS);
}

describe('the history lists with the company key cut off (decision 0068, B9)', () => {
  it("argo's inbox marks the payload it cannot unseal unreadable and lists the rest", async () => {
    const plain = await sentTo(argoId, { payload: PLAIN });
    const companyKey = await sealFleet(core, fleetId);
    const sealed = await sentTo(argoId, { payload: SEALED });
    await keyCutOff(companyKey);

    const inbox = unwrap(await history.readInbox(argo, { filter: 'all' })).items;

    expect(inbox.map(({ message }) => ({ id: message.id, payload: message.payload }))).toEqual([
      { id: sealed, payload: UNREADABLE },
      { id: plain, payload: PLAIN },
    ]);
  });

  it("one message of argo's inbox reads its plain payload and marks the reply argo sent sealed unreadable", async () => {
    const plain = await sentTo(argoId, { payload: PLAIN });
    const deliveryId = deliveryIdOf(core, plain);
    const companyKey = await sealFleet(core, fleetId);
    const { messageId: replyId } = unwrap(await messaging.replyToMessage(argo, { deliveryId, payload: SEALED, idempotencyKey: newKey() }));
    await keyCutOff(companyKey);

    const one = unwrap(await history.readInboxMessage(argo, { deliveryId }));

    expect({ payload: one.message.payload, replies: one.replies.map(({ id, payload }) => ({ id, payload })) }).toEqual({ payload: PLAIN, replies: [{ id: replyId, payload: UNREADABLE }] });
  });

  it('the withdrawals of a question mark the payload they cannot unseal unreadable and list the rest', async () => {
    const withdrawal = JSON.stringify({ questionId: QUESTION_ID });
    const plain = await sentTo(argoId, { payload: withdrawal, contentType: WITHDRAWAL_CONTENT_TYPE });
    const companyKey = await sealFleet(core, fleetId);
    const sealed = await sentTo(argoId, { payload: withdrawal, contentType: WITHDRAWAL_CONTENT_TYPE });
    await keyCutOff(companyKey);

    const withdrawals = unwrap(await history.readInboxWithdrawals(argo, { questionId: QUESTION_ID })).items;

    expect(withdrawals.map(({ message }) => ({ id: message.id, payload: message.payload }))).toEqual([
      { id: plain, payload: withdrawal },
      { id: sealed, payload: UNREADABLE },
    ]);
  });

  it("the ship page marks the preview it cannot unseal unreadable and lists the rest", async () => {
    const plain = await sentTo(scout.shipId, { payload: PLAIN });
    const companyKey = await sealFleet(core, fleetId);
    const sealed = await sentTo(scout.shipId, { payload: SEALED });
    await keyCutOff(companyKey);

    const listed = unwrap(await history.readShipMessages(operator, { shipId: tester.shipId })).items;

    expect(listed.map(({ id, preview, isPayloadUnreadable }) => ({ id, preview, isPayloadUnreadable }))).toEqual([
      { id: sealed, preview: '', isPayloadUnreadable: true },
      { id: plain, preview: PLAIN, isPayloadUnreadable: false },
    ]);
  });

  it('Needs attention marks the payload it cannot unseal unreadable and lists the rest', async () => {
    const plain = await sentTo(scout.shipId, { payload: PLAIN });
    const companyKey = await sealFleet(core, fleetId);
    const sealed = await sentTo(scout.shipId, { payload: SEALED });
    for (let claim = 1; claim <= UNDELIVERABLE_AT_ATTEMPT; claim += 1) {
      unwrap(await messaging.receiveDeliveries(scout, { max: 10 }));
    }
    await keyCutOff(companyKey);

    const attention = unwrap(await history.readNeedsAttention(operator, {})).items;

    expect(attention.map(({ message }) => ({ id: message.id, payload: message.payload }))).toEqual([
      { id: plain, payload: PLAIN },
      { id: sealed, payload: UNREADABLE },
    ]);
  });

  it("scenario 25: a message's page answers its envelope and its delivery, its payload marked unreadable", async () => {
    const companyKey = await sealFleet(core, fleetId);
    const sealed = await sentTo(argoId, { payload: SEALED });
    await keyCutOff(companyKey);

    const message = unwrap(await history.readMessage(operator, { messageId: sealed }));

    expect({ id: message.id, sender: message.sender.name, state: message.delivery.state, payload: message.payload, isPayloadSealed: message.isPayloadSealed }).toEqual({
      id: sealed,
      sender: 'tester-01',
      state: 'pending',
      payload: UNREADABLE,
      isPayloadSealed: true,
    });
  });
});

describe('the history reads say which payloads are sealed, for the console to mark (decision 0068, N1)', () => {
  it('the ship page, the inbox and a message read mark a payload sealed, and not one stored before sealing the pass has not sealed yet', async () => {
    const plain = await sentTo(argoId, { payload: PLAIN });
    await sealFleet(core, fleetId);
    const sealed = await sentTo(argoId, { payload: SEALED });

    const listed = unwrap(await history.readShipMessages(operator, { shipId: tester.shipId })).items;
    const inbox = unwrap(await history.readInbox(argo, { filter: 'all' })).items;
    const one = unwrap(await history.readMessage(operator, { messageId: sealed }));
    const before = unwrap(await history.readMessage(operator, { messageId: plain }));

    expect(listed.map(({ id, preview, isPayloadSealed }) => ({ id, preview, isPayloadSealed }))).toEqual([
      { id: sealed, preview: SEALED, isPayloadSealed: true },
      { id: plain, preview: PLAIN, isPayloadSealed: false },
    ]);
    expect(inbox.map(({ message }) => ({ id: message.id, payload: message.payload, isPayloadSealed: message.isPayloadSealed }))).toEqual([
      { id: sealed, payload: SEALED, isPayloadSealed: true },
      { id: plain, payload: PLAIN, isPayloadSealed: false },
    ]);
    expect([one.payload, one.isPayloadSealed, before.payload, before.isPayloadSealed]).toEqual([SEALED, true, PLAIN, false]);
  });
});
