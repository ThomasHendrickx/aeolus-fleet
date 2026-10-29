import {
  ANSWER_CONTENT_TYPE,
  createIdGenerator,
  QUESTION_CONTENT_TYPE,
  REPLACEMENT_CONTENT_TYPE,
  WITHDRAWAL_CONTENT_TYPE,
  type InboxMessage,
} from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { answerReplyOf, questionsIn } from './question-answer';

const newId = createIdGenerator();
const AT = '2026-10-11T09:00:00.000Z';

const QUESTION = {
  id: '3f1c2a9e-7b4d-4e8a-9c1f-2d6b8e0a5c47',
  title: 'Which port?',
  context: 'The docs name two.',
  options: [
    { key: 1, label: 'Keep 3000', detail: '' },
    { key: 2, label: 'Move to 4000', detail: '' },
  ],
  pick: { option: 1, why: 'Nothing else needs it.' },
};

const ASKER = { id: newId('ship'), name: 'implementer-b' };

function aMessage({
  contentType,
  payload,
  replies = [],
  sender = ASKER,
  sentAt = AT,
}: {
  contentType: string;
  payload: string;
  replies?: InboxMessage['replies'];
  sender?: InboxMessage['message']['sender'];
  sentAt?: string;
}): InboxMessage {
  return {
    deliveryId: newId('delivery'),
    state: 'pending',
    readAt: null,
    doneAt: null,
    repliedWith: null,
    replies,
    message: {
      id: newId('message'),
      sender,
      inReplyTo: null,
      sentAt,
      contentType,
      model: 'claude-opus-5-5',
      payload,
      isPayloadUnreadable: false,
    },
  };
}

const asked = aMessage({ contentType: QUESTION_CONTENT_TYPE, payload: JSON.stringify(QUESTION) });

const LATER = '2026-10-11T09:05:00.000Z';
const LATEST = '2026-10-11T09:10:00.000Z';
const NEW_QUESTION = { ...QUESTION, id: '9b2e4d6f-1a3c-4e5b-8d7f-0c2a4e6b8d1f', title: 'Which port, now that core moved?' };

function aWithdrawal({ sender = ASKER, sentAt = LATER }: { sender?: InboxMessage['message']['sender']; sentAt?: string } = {}): InboxMessage {
  return aMessage({ contentType: WITHDRAWAL_CONTENT_TYPE, payload: JSON.stringify({ questionId: QUESTION.id }), sender, sentAt });
}

function aReplacement({ sentAt = LATER }: { sentAt?: string } = {}): InboxMessage {
  return aMessage({ contentType: REPLACEMENT_CONTENT_TYPE, payload: JSON.stringify({ questionId: QUESTION.id, question: NEW_QUESTION }), sentAt });
}

function anAnswerTo(question: { id: string }): InboxMessage['replies'][number] {
  return { id: newId('message'), contentType: ANSWER_CONTENT_TYPE, payload: JSON.stringify({ questionId: question.id, option: 1 }), isPayloadUnreadable: false, sentAt: LATER };
}

function questionAsked(questions: ReturnType<typeof questionsIn>, deliveryId: string) {
  return questions.find((question) => question.deliveryId === deliveryId);
}

describe('questionsIn', () => {
  it('keeps the messages that ask a question, open while argo has not answered', () => {
    const plain = aMessage({ contentType: 'text/plain', payload: 'Promote?' });
    const [found, ...others] = questionsIn([plain, asked]);

    expect(others).toEqual([]);
    expect(found).toMatchObject({ deliveryId: asked.deliveryId, message: asked.message, question: { ...QUESTION, answer: null } });
    expect(found).not.toHaveProperty('replies');
  });

  it('leaves out a message of the question type whose payload is no question', () => {
    expect(questionsIn([aMessage({ contentType: QUESTION_CONTENT_TYPE, payload: 'Which port?' })])).toEqual([]);
  });

  it("reads the answer from argo's replies", () => {
    const reply = { id: newId('message'), contentType: ANSWER_CONTENT_TYPE, payload: JSON.stringify({ questionId: QUESTION.id, option: 2 }), isPayloadUnreadable: false, sentAt: AT };
    const answered = { ...asked, replies: [reply] };

    expect(questionsIn([answered])[0]?.question.answer).toEqual({ messageId: reply.id, sentAt: AT, option: 2, note: null });
  });

  it('is not stale while the asker has neither withdrawn nor replaced it', () => {
    expect(questionsIn([asked])[0]?.stale).toBeNull();
  });

  it('is stale once the asker withdraws it, from the withdrawal', () => {
    const withdrawal = aWithdrawal();

    expect(questionAsked(questionsIn([withdrawal, asked]), asked.deliveryId)?.stale).toEqual({
      kind: 'withdrawn',
      deliveryId: withdrawal.deliveryId,
      sentAt: LATER,
    });
  });

  it('leaves the withdrawal out of the questions', () => {
    expect(questionsIn([aWithdrawal(), asked]).map(({ deliveryId }) => deliveryId)).toEqual([asked.deliveryId]);
  });

  it('is stale once the asker replaces it, linked to the replacement', () => {
    const replacement = aReplacement();

    expect(questionAsked(questionsIn([replacement, asked]), asked.deliveryId)?.stale).toEqual({
      kind: 'replaced',
      deliveryId: replacement.deliveryId,
      sentAt: LATER,
      by: { title: NEW_QUESTION.title },
    });
  });

  it('asks the replacement as an open question of its own', () => {
    const replacement = aReplacement();

    expect(questionAsked(questionsIn([replacement, asked]), replacement.deliveryId)).toMatchObject({
      question: { ...NEW_QUESTION, answer: null },
      stale: null,
    });
  });

  it('links the replacement to the question it replaces', () => {
    const replacement = aReplacement();

    expect(questionAsked(questionsIn([replacement, asked]), replacement.deliveryId)?.replaces).toEqual({ deliveryId: asked.deliveryId, title: QUESTION.title });
  });

  it('asks a replacement of an answered question as an open question, linked to the answered one', () => {
    const replacement = aReplacement({ sentAt: LATEST });
    const answered = { ...asked, replies: [anAnswerTo(QUESTION)] };

    expect(questionAsked(questionsIn([replacement, answered]), replacement.deliveryId)).toMatchObject({
      question: { answer: null },
      stale: null,
      replaces: { deliveryId: asked.deliveryId, title: QUESTION.title },
    });
  });

  it('links a question that replaces none to nothing', () => {
    expect(questionsIn([asked])[0]?.replaces).toBeNull();
  });

  it('links a replacement by another ship to nothing', () => {
    const replacement = { ...aReplacement(), message: { ...aReplacement().message, sender: { id: newId('ship'), name: 'implementer-c' } } };

    expect(questionAsked(questionsIn([replacement, asked]), replacement.deliveryId)?.replaces).toBeNull();
  });

  it('takes the first of several withdrawals and replacements', () => {
    const replacement = aReplacement({ sentAt: LATEST });
    const withdrawal = aWithdrawal({ sentAt: LATER });

    expect(questionAsked(questionsIn([replacement, withdrawal, asked]), asked.deliveryId)?.stale).toMatchObject({ kind: 'withdrawn' });
  });

  it('is not stale when another ship withdraws it', () => {
    const withdrawal = aWithdrawal({ sender: { id: newId('ship'), name: 'implementer-c' } });

    expect(questionAsked(questionsIn([withdrawal, asked]), asked.deliveryId)?.stale).toBeNull();
  });

  it('stays answered when the asker withdraws it after the answer', () => {
    const answered = { ...asked, replies: [anAnswerTo(QUESTION)] };

    expect(questionAsked(questionsIn([aWithdrawal({ sentAt: LATEST }), answered]), asked.deliveryId)?.stale).toBeNull();
  });
});

describe('answerReplyOf', () => {
  it('answers with one option and a note, as the answer content type naming the question', () => {
    expect(answerReplyOf({ inbox: [asked], deliveryId: asked.deliveryId, answer: { option: 2, note: 'Tell core first.' } })).toEqual({
      kind: 'answered',
      data: { contentType: ANSWER_CONTENT_TYPE, payload: JSON.stringify({ questionId: QUESTION.id, option: 2, note: 'Tell core first.' }) },
    });
  });

  it('answers with a note alone', () => {
    expect(answerReplyOf({ inbox: [asked], deliveryId: asked.deliveryId, answer: { note: 'Which docs?' } })).toEqual({
      kind: 'answered',
      data: { contentType: ANSWER_CONTENT_TYPE, payload: JSON.stringify({ questionId: QUESTION.id, note: 'Which docs?' }) },
    });
  });

  it('refuses an option the question does not have', () => {
    expect(answerReplyOf({ inbox: [asked], deliveryId: asked.deliveryId, answer: { option: 3 } })).toEqual({ kind: 'refused', message: 'The question has no option 3' });
  });

  it('refuses a message that asks no question', () => {
    const plain = aMessage({ contentType: 'text/plain', payload: 'Promote?' });

    expect(answerReplyOf({ inbox: [plain], deliveryId: plain.deliveryId, answer: { option: 1 } })).toEqual({
      kind: 'refused',
      message: 'That message asks no question',
    });
  });

  it('refuses a message that is not in the inbox', () => {
    expect(answerReplyOf({ inbox: [asked], deliveryId: newId('delivery'), answer: { option: 1 } })).toEqual({
      kind: 'refused',
      message: 'That question is not in your inbox',
    });
  });

  it('refuses a question the asker withdrew', () => {
    expect(answerReplyOf({ inbox: [aWithdrawal(), asked], deliveryId: asked.deliveryId, answer: { option: 1 } })).toEqual({
      kind: 'refused',
      message: 'implementer-b withdrew that question',
    });
  });

  it('refuses a question the asker replaced', () => {
    expect(answerReplyOf({ inbox: [aReplacement(), asked], deliveryId: asked.deliveryId, answer: { option: 1 } })).toEqual({
      kind: 'refused',
      message: 'implementer-b replaced that question; answer the new one',
    });
  });

  it('refuses a question argo already answered, so an answer is sent once (#870)', () => {
    const answered = { ...asked, replies: [anAnswerTo(QUESTION)] };

    expect(answerReplyOf({ inbox: [answered], deliveryId: answered.deliveryId, answer: { option: 2 } })).toEqual({
      kind: 'refused',
      message: 'You already answered that question',
    });
  });

  it('answers a replacement, naming the new question', () => {
    const replacement = aReplacement();

    expect(answerReplyOf({ inbox: [replacement, asked], deliveryId: replacement.deliveryId, answer: { option: 1 } })).toEqual({
      kind: 'answered',
      data: { contentType: ANSWER_CONTENT_TYPE, payload: JSON.stringify({ questionId: NEW_QUESTION.id, option: 1 }) },
    });
  });
});
