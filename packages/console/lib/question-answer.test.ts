import { ANSWER_CONTENT_TYPE, createIdGenerator, QUESTION_CONTENT_TYPE, type InboxMessage } from '@aeolus-fleet/common';
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

function aMessage({ contentType, payload, replies = [] }: { contentType: string; payload: string; replies?: InboxMessage['replies'] }): InboxMessage {
  return {
    deliveryId: newId('delivery'),
    state: 'pending',
    readAt: null,
    doneAt: null,
    repliedWith: null,
    replies,
    message: {
      id: newId('message'),
      sender: { id: newId('ship'), name: 'implementer-b' },
      inReplyTo: null,
      sentAt: AT,
      contentType,
      model: 'claude-opus-5-5',
      payload,
    },
  };
}

const asked = aMessage({ contentType: QUESTION_CONTENT_TYPE, payload: JSON.stringify(QUESTION) });

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
    const reply = { id: newId('message'), contentType: ANSWER_CONTENT_TYPE, payload: JSON.stringify({ questionId: QUESTION.id, option: 2 }), sentAt: AT };
    const answered = { ...asked, replies: [reply] };

    expect(questionsIn([answered])[0]?.question.answer).toEqual({ messageId: reply.id, sentAt: AT, option: 2, note: null });
  });
});

describe('answerReplyOf', () => {
  it('answers with one option and a note, as the answer content type naming the question', () => {
    expect(answerReplyOf(asked, { option: 2, note: 'Tell core first.' })).toEqual({
      kind: 'answered',
      data: { contentType: ANSWER_CONTENT_TYPE, payload: JSON.stringify({ questionId: QUESTION.id, option: 2, note: 'Tell core first.' }) },
    });
  });

  it('answers with a note alone', () => {
    expect(answerReplyOf(asked, { note: 'Which docs?' })).toEqual({
      kind: 'answered',
      data: { contentType: ANSWER_CONTENT_TYPE, payload: JSON.stringify({ questionId: QUESTION.id, note: 'Which docs?' }) },
    });
  });

  it('refuses an option the question does not have', () => {
    expect(answerReplyOf(asked, { option: 3 })).toEqual({ kind: 'refused', message: 'The question has no option 3' });
  });

  it('refuses a message that asks no question', () => {
    expect(answerReplyOf(aMessage({ contentType: 'text/plain', payload: 'Promote?' }), { option: 1 })).toEqual({
      kind: 'refused',
      message: 'That message asks no question',
    });
  });
});
