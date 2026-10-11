import { ANSWER_CONTENT_TYPE, QUESTION_CONTENT_TYPE, type DeliveryId, type MessageId, type ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  argoAboard,
  crewAboard,
  deliveryIdOf,
  initialiseFleet,
  messagingUseCases,
  modelOf,
  operatorCaller,
  registryUseCases,
} from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../../test/support/keys.js';
import { unwrap } from '../../../test/support/result.js';
import type { Crew } from '../shared/caller.js';
import { createAnswerQuestion, type AnswerQuestion } from './answer-question.js';

const QUESTION_ID = '3f1c2a9e-7b4d-4e8a-9c1f-2d6b8e0a5c47';

const aQuestion = {
  id: QUESTION_ID,
  title: 'Which port does the console use?',
  context: 'The docs name two ports.',
  options: [
    { key: 1, label: 'Keep 3000', detail: 'What the console uses now.' },
    { key: 2, label: 'Move to 4000', detail: 'Frees 3000 for core.' },
  ],
  pick: { option: 1, why: 'Nothing else needs 3000.' },
};

let core: InMemoryCore;
let useCases: ReturnType<typeof messagingUseCases>;
let answerQuestion: AnswerQuestion;
let argoId: ShipId;
let argo: Crew;
let asker: Crew;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-11T09:00:00.000Z');
  const fleet = await initialiseFleet(core);
  argoId = fleet.operatorShipId;
  const { shipId } = unwrap(
    await registryUseCases(core).commissionShip(operatorCaller(fleet), { idempotencyKey: newKey(), name: 'implementer-b', type: 'implementer' }),
  );
  asker = crewAboard(core, { fleetId: fleet.fleetId, shipId });
  argo = await argoAboard(core);
  useCases = messagingUseCases(core);
  answerQuestion = createAnswerQuestion({ uow: core.uow, clock: core.clock, ids: core.ids, hasher: core.hasher });
  core.clock.advance(60_000);
});

/** A message from implementer-b to argo, waiting in argo's inbox. */
async function toArgo(message: { contentType: string; payload: string }): Promise<{ deliveryId: DeliveryId; messageId: MessageId }> {
  const { messageId } = unwrap(
    await useCases.sendMessage(asker, {
      ...modelOf(asker),
      selector: { kind: 'ship', shipId: argoId },
      ...message,
      idempotencyKey: newKey(),
    }),
  );
  core.state.events.length = 0;
  core.state.notices.length = 0;
  core.clock.advance(60_000);
  return { deliveryId: deliveryIdOf(core, messageId), messageId };
}

function asked() {
  return toArgo({ contentType: QUESTION_CONTENT_TYPE, payload: JSON.stringify(aQuestion) });
}

function message(messageId: MessageId) {
  return core.state.messages.find((held) => held.id === messageId);
}

function stored(deliveryId: DeliveryId) {
  return core.state.deliveries.find((held) => held.id === deliveryId);
}

describe('answering a question to argo', () => {
  it('sends the answer from argo to the asking ship, as a reply of the answer type naming the question', async () => {
    const question = await asked();

    const { messageId } = unwrap(
      await answerQuestion(argo, { deliveryId: question.deliveryId, answer: { option: 2, note: 'Tell core first.' }, idempotencyKey: 'answer-1' }),
    );
    expect(message(messageId)).toMatchObject({
      senderShipId: argoId,
      selector: { kind: 'ship', shipId: asker.shipId },
      contentType: ANSWER_CONTENT_TYPE,
      inReplyToMessageId: question.messageId,
    });
    expect(JSON.parse(message(messageId)?.payload ?? '')).toEqual({ questionId: QUESTION_ID, option: 2, note: 'Tell core first.' });
    expect(core.state.notices).toEqual([expect.objectContaining({ recipient: { kind: 'ship', shipId: asker.shipId } })]);
  });

  it('answers with a note alone', async () => {
    const question = await asked();

    const { messageId } = unwrap(
      await answerQuestion(argo, { deliveryId: question.deliveryId, answer: { note: 'Which docs?' }, idempotencyKey: 'answer-1' }),
    );
    expect(JSON.parse(message(messageId)?.payload ?? '')).toEqual({ questionId: QUESTION_ID, note: 'Which docs?' });
  });

  it('marks the question done in the same step, its acknowledgement naming the answer', async () => {
    const question = await asked();

    const { messageId } = unwrap(await answerQuestion(argo, { deliveryId: question.deliveryId, answer: { option: 1 }, idempotencyKey: 'answer-1' }));
    expect(stored(question.deliveryId)?.state).toBe('acknowledged');
    expect(core.state.events.map((event) => event.type)).toEqual(['MessageAccepted', 'DeliveryClaimed', 'DeliveryAcknowledged']);
    expect(core.state.events[2]?.details).toEqual({ leaseId: argo.leaseId, reply: messageId });
  });

  it('answers a question already marked done, which stays done', async () => {
    const question = await asked();
    unwrap(await useCases.markDone(argo, { deliveryId: question.deliveryId }));
    core.state.events.length = 0;

    unwrap(await answerQuestion(argo, { deliveryId: question.deliveryId, answer: { option: 1 }, idempotencyKey: 'answer-1' }));
    expect(core.state.events.map((event) => event.type)).toEqual(['MessageAccepted']);
    expect(stored(question.deliveryId)?.state).toBe('acknowledged');
  });

  it('answers a repeat of the answer with the same message, and stores nothing more', async () => {
    const question = await asked();
    const answer = { deliveryId: question.deliveryId, answer: { option: 1 }, idempotencyKey: 'answer-1' };
    const first = unwrap(await answerQuestion(argo, answer));
    const messages = core.state.messages.length;

    await expect(answerQuestion(argo, answer)).resolves.toEqual({ isOk: true, value: first });
    expect(core.state.messages).toHaveLength(messages);
  });

  it('refuses an option the question does not have, sending nothing and leaving it open', async () => {
    const question = await asked();
    const messages = core.state.messages.length;

    await expect(
      answerQuestion(argo, { deliveryId: question.deliveryId, answer: { option: 3 }, idempotencyKey: 'answer-1' }),
    ).resolves.toMatchObject({ isOk: false, error: { kind: 'UNKNOWN_OPTION' } });
    expect(core.state.messages).toHaveLength(messages);
    expect(stored(question.deliveryId)?.state).toBe('pending');
  });

  it('refuses a message of another type, sending nothing', async () => {
    const plain = await toArgo({ contentType: 'text/plain', payload: 'Which port?' });
    const messages = core.state.messages.length;

    await expect(
      answerQuestion(argo, { deliveryId: plain.deliveryId, answer: { option: 1 }, idempotencyKey: 'answer-1' }),
    ).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_A_QUESTION' } });
    expect(core.state.messages).toHaveLength(messages);
  });

  it('refuses a message of the question type whose payload is no question', async () => {
    const broken = await toArgo({ contentType: QUESTION_CONTENT_TYPE, payload: '{"title":"Which port?"}' });

    await expect(
      answerQuestion(argo, { deliveryId: broken.deliveryId, answer: { note: 'What?' }, idempotencyKey: 'answer-1' }),
    ).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_A_QUESTION' } });
  });

  it("refuses a delivery that is not in argo's inbox", async () => {
    await expect(
      answerQuestion(argo, { deliveryId: core.ids('delivery'), answer: { option: 1 }, idempotencyKey: 'answer-1' }),
    ).resolves.toMatchObject({ isOk: false, error: { kind: 'DELIVERY_NOT_FOUND' } });
  });

  it('refuses any ship but argo', async () => {
    const question = await asked();

    await expect(
      answerQuestion(asker, { deliveryId: question.deliveryId, answer: { option: 1 }, idempotencyKey: 'answer-1' }),
    ).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_THE_OPERATOR_SHIP' } });
  });
});
