import { WITHDRAWAL_CONTENT_TYPE, type DeliveryId, type FleetId, type MessageId, type ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { argoAboard, crewAboard, deliveryIdOf, historyUseCases, initialiseFleet, messagingUseCases, modelOf, operatorCaller, registryUseCases, sealFleet } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';
import type { Crew, ShipCaller } from './caller.js';

/**
 * The history reads in a sealed fleet (decision 0068, B9, B17): every read
 * that answers a payload unseals it, outside any unit of work, and answers
 * it exactly as sent. The tester asks argo; argo answers from its inbox.
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

/** Payloads with bytes past ASCII, so they come back exactly or not at all. */
const QUESTION = 'checkout-e2e failed 3 of 5 runs at the café since 12:00: rerun?';
const ANSWER = 'Rerun it, 5 € budget';
const QUESTION_ID = '0f8e2c1a-5b7d-4e3f-9a6b-2c4d8e1f0a3b';

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
  await sealFleet(core, fleetId);
});

/** The tester's question to argo, answered by argo from its inbox. */
async function askedAndAnswered(): Promise<{ messageId: MessageId; deliveryId: DeliveryId; replyId: MessageId }> {
  const { messageId } = unwrap(await messaging.sendMessage(tester, { ...modelOf(tester), selector: { kind: 'ship', shipId: argoId }, payload: QUESTION, idempotencyKey: newKey() }));
  const deliveryId = deliveryIdOf(core, messageId);
  core.clock.advance(60_000);
  const { messageId: replyId } = unwrap(await messaging.replyToMessage(argo, { deliveryId, payload: ANSWER, idempotencyKey: newKey() }));
  return { messageId, deliveryId, replyId };
}

describe('the history reads in a sealed fleet (decision 0068, B9)', () => {
  it("answers argo's inbox, one of its messages and the reply argo sent, each payload as sent", async () => {
    const { messageId, deliveryId, replyId } = await askedAndAnswered();

    const inbox = unwrap(await history.readInbox(argo, { filter: 'all' })).items;
    const one = unwrap(await history.readInboxMessage(argo, { deliveryId }));

    expect(inbox.map((entry) => ({ id: entry.message.id, payload: entry.message.payload, replies: entry.replies.map(({ id, payload }) => ({ id, payload })) }))).toEqual([
      { id: messageId, payload: QUESTION, replies: [{ id: replyId, payload: ANSWER }] },
    ]);
    expect([one.message.payload, one.replies.map(({ payload }) => payload)]).toEqual([QUESTION, [ANSWER]]);
  });

  it('answers the withdrawals of a question in the inbox by the question id, each payload as sent', async () => {
    const withdrawal = JSON.stringify({ questionId: QUESTION_ID });
    unwrap(await messaging.sendMessage(tester, { ...modelOf(tester), selector: { kind: 'ship', shipId: argoId }, contentType: WITHDRAWAL_CONTENT_TYPE, payload: withdrawal, idempotencyKey: newKey() }));

    const withdrawals = unwrap(await history.readInboxWithdrawals(argo, { questionId: QUESTION_ID })).items;

    expect(withdrawals.map(({ message }) => message.payload)).toEqual([withdrawal]);
  });

  it("answers a message's page with its whole payload, and the ship page with its preview", async () => {
    const { messageId, replyId } = await askedAndAnswered();

    const page = unwrap(await history.readMessage(operator, { messageId }));
    const listed = unwrap(await history.readShipMessages(operator, { shipId: tester.shipId })).items;

    expect(page.payload).toBe(QUESTION);
    expect(listed.map(({ id, preview }) => ({ id, preview }))).toEqual([
      { id: replyId, preview: ANSWER },
      { id: messageId, preview: QUESTION },
    ]);
  });

  it('answers Needs attention with each undeliverable message whole', async () => {
    const { messageId } = unwrap(await messaging.sendMessage(tester, { ...modelOf(tester), selector: { kind: 'ship', shipId: scout.shipId }, payload: QUESTION, idempotencyKey: newKey() }));
    for (let claim = 1; claim <= UNDELIVERABLE_AT_ATTEMPT; claim += 1) {
      unwrap(await messaging.receiveDeliveries(scout, {}));
    }

    const attention = unwrap(await history.readNeedsAttention(operator, {})).items;

    expect(attention.map(({ message }) => ({ id: message.id, payload: message.payload }))).toEqual([{ id: messageId, payload: QUESTION }]);
  });

  it('answers a sender where its sealed message stands, with no payload', async () => {
    const { messageId } = unwrap(await messaging.sendMessage(tester, { ...modelOf(tester), selector: { kind: 'ship', shipId: argoId }, payload: QUESTION, idempotencyKey: newKey() }));

    const sent = unwrap(await history.sentMessage(tester, { messageId }));

    expect(sent).toMatchObject({ messageId, deliveries: [{ ship: { id: argoId }, state: 'pending' }] });
  });
});
