import { WITHDRAWAL_CONTENT_TYPE, type FleetId, type MessageId, type ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { argoAboard, crewAboard, deliveryIdOf, historyUseCases, initialiseFleet, messagingUseCases, modelOf, operatorCaller, registryUseCases, sealFleet } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../testing/keys.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import { DATA_KEY_CACHE_MS } from '../messaging/data-keys.js';
import type { Crew, ShipCaller } from './caller.js';

/**
 * The history reads with a sealed fleet's company key cut off (decision
 * 0068, B9): a read that lists several payloads marks each one it cannot
 * unseal unreadable and lists the rest; a read of one payload refuses
 * KEY_UNAVAILABLE. The fleet stored a payload plain before it was sealed, so
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

async function sentTo(shipId: ShipId, payload: string, options: { contentType?: string } = {}): Promise<MessageId> {
  core.clock.advance(1_000);
  return unwrap(await messaging.sendMessage(tester, { ...modelOf(tester), selector: { kind: 'ship', shipId }, payload, idempotencyKey: newKey(), ...options })).messageId;
}

/** The company disables its key and every server's data key cache runs out. */
async function keyCutOff(companyKey: string): Promise<void> {
  await core.keyVault.disable(companyKey);
  core.clock.advance(DATA_KEY_CACHE_MS);
}

describe('the history lists with the company key cut off (decision 0068, B9)', () => {
  it("argo's inbox marks the payload it cannot unseal unreadable and lists the rest", async () => {
    const plain = await sentTo(argoId, PLAIN);
    const companyKey = await sealFleet(core, fleetId);
    const sealed = await sentTo(argoId, SEALED);
    await keyCutOff(companyKey);

    const inbox = unwrap(await history.readInbox(argo, { filter: 'all' })).items;

    expect(inbox.map(({ message }) => ({ id: message.id, payload: message.payload }))).toEqual([
      { id: sealed, payload: UNREADABLE },
      { id: plain, payload: PLAIN },
    ]);
  });

  it("one message of argo's inbox reads its plain payload and marks the reply argo sent sealed unreadable", async () => {
    const plain = await sentTo(argoId, PLAIN);
    const deliveryId = deliveryIdOf(core, plain);
    const companyKey = await sealFleet(core, fleetId);
    const { messageId: replyId } = unwrap(await messaging.replyToMessage(argo, { deliveryId, payload: SEALED, idempotencyKey: newKey() }));
    await keyCutOff(companyKey);

    const one = unwrap(await history.readInboxMessage(argo, { deliveryId }));

    expect({ payload: one.message.payload, replies: one.replies.map(({ id, payload }) => ({ id, payload })) }).toEqual({ payload: PLAIN, replies: [{ id: replyId, payload: UNREADABLE }] });
  });

  it('the withdrawals of a question mark the payload they cannot unseal unreadable and list the rest', async () => {
    const withdrawal = JSON.stringify({ questionId: QUESTION_ID });
    const plain = await sentTo(argoId, withdrawal, { contentType: WITHDRAWAL_CONTENT_TYPE });
    const companyKey = await sealFleet(core, fleetId);
    const sealed = await sentTo(argoId, withdrawal, { contentType: WITHDRAWAL_CONTENT_TYPE });
    await keyCutOff(companyKey);

    const withdrawals = unwrap(await history.readInboxWithdrawals(argo, { questionId: QUESTION_ID })).items;

    expect(withdrawals.map(({ message }) => ({ id: message.id, payload: message.payload }))).toEqual([
      { id: plain, payload: withdrawal },
      { id: sealed, payload: UNREADABLE },
    ]);
  });

  it("the ship page marks the preview it cannot unseal unreadable and lists the rest", async () => {
    const plain = await sentTo(scout.shipId, PLAIN);
    const companyKey = await sealFleet(core, fleetId);
    const sealed = await sentTo(scout.shipId, SEALED);
    await keyCutOff(companyKey);

    const listed = unwrap(await history.readShipMessages(operator, { shipId: tester.shipId })).items;

    expect(listed.map(({ id, preview, isPayloadUnreadable }) => ({ id, preview, isPayloadUnreadable }))).toEqual([
      { id: sealed, preview: '', isPayloadUnreadable: true },
      { id: plain, preview: PLAIN, isPayloadUnreadable: false },
    ]);
  });

  it('Needs attention marks the payload it cannot unseal unreadable and lists the rest', async () => {
    const plain = await sentTo(scout.shipId, PLAIN);
    const companyKey = await sealFleet(core, fleetId);
    const sealed = await sentTo(scout.shipId, SEALED);
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

  it("a message's page, one payload, is refused KEY_UNAVAILABLE", async () => {
    const companyKey = await sealFleet(core, fleetId);
    const sealed = await sentTo(argoId, SEALED);
    await keyCutOff(companyKey);

    const refusal = refusalOf(await history.readMessage(operator, { messageId: sealed }));

    expect(refusal.kind).toBe('KEY_UNAVAILABLE');
  });
});
