import { ANSWER_CONTENT_TYPE, WITHDRAWAL_CONTENT_TYPE, type DeliveryId, type FleetId, type MessageId, type Question, type ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { agentCaller, argoAboard, crewAboard, historyUseCases, initialiseFleet, messagingUseCases, operatorCaller, registryUseCases, sealFleet, SESSION_MODEL } from '../../../test/support/core-fixtures.js';
import { aQuestion } from '../../../test/support/formatted-message-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';
import { isSealedPayload } from '../messaging/public.js';
import type { Crew, ShipCaller } from '../shared/caller.js';

/**
 * Retiring a ship withdraws every open question it asked (#1632, Thomas's
 * option 1, "Withdraw on retirement"), in the retire's unit of work, as the
 * ship's own withdraw would: so the asked ship sees it go as a withdrawn
 * question goes (decision 0038), and no answer is written to a ship that can
 * no longer be addressed. Scout asks argo and lookout; argo retires scout.
 */
let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let messaging: ReturnType<typeof messagingUseCases>;
let history: ReturnType<typeof historyUseCases>;
let fleetId: FleetId;
let argoId: ShipId;
let operator: ShipCaller;
let argo: Crew;
let scout: ShipCaller;
let lookout: ShipCaller;

const FIRST_QUESTION = '11111111-1111-4111-8111-111111111111';
const SECOND_QUESTION = '33333333-3333-4333-8333-333333333333';
const NEW_QUESTION = '44444444-4444-4444-8444-444444444444';

beforeEach(async () => {
  core = createInMemoryCore('2026-11-15T09:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId, operatorShipId: argoId } = fleet);
  operator = operatorCaller(fleet);
  registry = registryUseCases(core);
  messaging = messagingUseCases(core);
  history = historyUseCases(core);
  argo = await argoAboard(core);
  scout = agentCaller({ fleetId, shipId: unwrap(await registry.commissionShip(operator, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })).shipId });
  lookout = agentCaller({ fleetId, shipId: unwrap(await registry.commissionShip(operator, { idempotencyKey: newKey(), name: 'lookout', type: 'reviewer' })).shipId });
});

async function asked(from: ShipCaller, { to, question }: { to: ShipId; question: Question }): Promise<{ messageId: MessageId; deliveryId: DeliveryId }> {
  core.clock.advance(1_000);
  const { messageId } = unwrap(
    await messaging.sendFormattedMessage(from, { selector: { kind: 'ship', shipId: to }, message: { kind: 'question', question }, model: SESSION_MODEL, idempotencyKey: newKey() }),
  );
  const delivery = core.state.deliveries.find((held) => held.messageId === messageId);
  return { messageId, deliveryId: delivery?.id ?? core.ids('delivery') };
}

async function retired(ship: ShipCaller): Promise<void> {
  core.clock.advance(1_000);
  unwrap(await registry.retireShip(operator, { shipId: ship.shipId }));
}

/** The withdrawals stored, each as sent: from whom, to whom, naming which question. */
function withdrawals() {
  return core.state.messages
    .filter(({ contentType }) => contentType === WITHDRAWAL_CONTENT_TYPE)
    .map(({ senderShipId, selector, payload, questionId }) => ({ senderShipId, selector, payload, questionId }));
}

function withdrawalOf(from: ShipCaller, { to, questionId }: { to: ShipId; questionId: string }) {
  return { senderShipId: from.shipId, selector: { kind: 'ship', shipId: to }, payload: JSON.stringify({ questionId }), questionId };
}

describe('retiring a ship that asked a question nobody answered', () => {
  it('withdraws it from argo as its own withdraw would: a withdrawal from it, pending for argo, with MessageAccepted caused by the retire\'s actor', async () => {
    await asked(scout, { to: argoId, question: aQuestion({ id: FIRST_QUESTION }) });

    await retired(scout);

    const [withdrawal] = core.state.messages.filter(({ contentType }) => contentType === WITHDRAWAL_CONTENT_TYPE);
    expect([
      withdrawals(),
      core.state.deliveries.filter(({ messageId }) => messageId === withdrawal?.id).map(({ recipient, state }) => ({ recipient, state })),
      core.state.events.filter(({ type, messageId }) => type === 'MessageAccepted' && messageId === withdrawal?.id).map(({ shipId, actor, occurredAt }) => ({ shipId, actor, occurredAt })),
    ]).toEqual([
      [withdrawalOf(scout, { to: argoId, questionId: FIRST_QUESTION })],
      [{ recipient: { kind: 'ship', shipId: argoId }, state: 'pending' }],
      [{ shipId: argoId, actor: { kind: 'ship', shipId: operator.shipId }, occurredAt: core.clock.now() }],
    ]);
  });

  it("shows argo the question as gone: its inbox finds the withdrawal by the question's uuid", async () => {
    await asked(scout, { to: argoId, question: aQuestion({ id: FIRST_QUESTION }) });

    await retired(scout);

    const found = unwrap(await history.readInboxWithdrawals(argo, { questionId: FIRST_QUESTION }));
    expect(found.items.map(({ message }) => ({ sender: message.sender.id, contentType: message.contentType }))).toEqual([{ sender: scout.shipId, contentType: WITHDRAWAL_CONTENT_TYPE }]);
  });

  it('withdraws each open question from the ship it asked, argo or another ship', async () => {
    await asked(scout, { to: argoId, question: aQuestion({ id: FIRST_QUESTION }) });
    await asked(scout, { to: lookout.shipId, question: aQuestion({ id: SECOND_QUESTION }) });

    await retired(scout);

    expect(withdrawals()).toEqual([withdrawalOf(scout, { to: argoId, questionId: FIRST_QUESTION }), withdrawalOf(scout, { to: lookout.shipId, questionId: SECOND_QUESTION })]);
  });

  it('withdraws the open replacement by its own uuid, and not the question it replaced', async () => {
    await asked(scout, { to: argoId, question: aQuestion({ id: FIRST_QUESTION }) });
    unwrap(
      await messaging.sendMessage(scout, {
        selector: { kind: 'ship', shipId: argoId },
        contentType: 'application/vnd.aeolus.question-replacement+json',
        payload: JSON.stringify({ questionId: FIRST_QUESTION, question: aQuestion({ id: NEW_QUESTION }) }),
        model: SESSION_MODEL,
        idempotencyKey: newKey(),
      }),
    );

    await retired(scout);

    expect(withdrawals()).toEqual([withdrawalOf(scout, { to: argoId, questionId: NEW_QUESTION })]);
  });
});

describe('retiring a ship whose questions are settled', () => {
  it('withdraws nothing argo answered, nor what the ship withdrew itself', async () => {
    const answered = await asked(scout, { to: argoId, question: aQuestion({ id: FIRST_QUESTION }) });
    unwrap(await messaging.replyToMessage(argo, { deliveryId: answered.deliveryId, contentType: ANSWER_CONTENT_TYPE, payload: JSON.stringify({ questionId: FIRST_QUESTION, option: 2 }), idempotencyKey: newKey() }));
    await asked(scout, { to: argoId, question: aQuestion({ id: SECOND_QUESTION }) });
    unwrap(await messaging.sendFormattedMessage(scout, { selector: { kind: 'ship', shipId: argoId }, message: { kind: 'withdrawal', target: { kind: 'question', questionId: SECOND_QUESTION } }, model: SESSION_MODEL, idempotencyKey: newKey() }));

    await retired(scout);

    expect(withdrawals()).toEqual([withdrawalOf(scout, { to: argoId, questionId: SECOND_QUESTION })]);
  });

  it('withdraws nothing from a ship it asked that is retired already: it is never addressed again', async () => {
    await asked(scout, { to: lookout.shipId, question: aQuestion({ id: FIRST_QUESTION }) });
    await retired(lookout);

    await retired(scout);

    expect(withdrawals()).toEqual([]);
  });
});

describe('retiring a ship with an open question in a sealed fleet (decision 0068)', () => {
  it('reads the sealed question, stores the withdrawal sealed, and the asked ship receives it as written', async () => {
    await sealFleet(core, fleetId);
    await asked(scout, { to: lookout.shipId, question: aQuestion({ id: FIRST_QUESTION }) });

    await retired(scout);

    const { deliveries } = unwrap(await messaging.receiveDeliveries(crewAboard(core, lookout), { max: 10 }));
    expect([
      core.state.messages.filter((message) => !isSealedPayload(message.payload)).length,
      deliveries.filter(({ contentType }) => contentType === WITHDRAWAL_CONTENT_TYPE).map(({ payload }) => payload),
    ]).toEqual([0, [JSON.stringify({ questionId: FIRST_QUESTION })]]);
  });
});
