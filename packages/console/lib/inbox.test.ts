import { createIdGenerator, QUESTION_CONTENT_TYPE, REPLACEMENT_CONTENT_TYPE, WITHDRAWAL_CONTENT_TYPE, type InboxMessage } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { filterCounts, inboxPathOf, messagesFor, plainMessagesOf, readInboxFilter } from './inbox';
import { questionsIn } from './question-answer';
import { questionDeliveryIdsOf, questionFilterCounts } from './questions';

const newId = createIdGenerator();
const pending = { id: 'a', state: 'pending' } as const;
const delivered = { id: 'b', state: 'delivered' } as const;
const acknowledged = { id: 'c', state: 'acknowledged' } as const;
const messages = [pending, acknowledged, delivered];

describe('messagesFor', () => {
  it('keeps the messages not done yet for Open, in order', () => {
    expect(messagesFor(messages, 'open')).toEqual([pending, delivered]);
  });

  it('keeps the acknowledged ones for Done', () => {
    expect(messagesFor(messages, 'done')).toEqual([acknowledged]);
  });

  it('keeps every one for All', () => {
    expect(messagesFor(messages, 'all')).toEqual(messages);
  });
});

describe('filterCounts', () => {
  it('counts each filter', () => {
    expect(filterCounts(messages)).toEqual({ open: 2, done: 1, all: 3 });
  });
});

describe('readInboxFilter', () => {
  it.each([
    [undefined, 'open'],
    ['done', 'done'],
    ['all', 'all'],
    ['unread', 'open'],
  ] as const)('reads %s as %s', (value, filter) => {
    expect(readInboxFilter(value)).toBe(filter);
  });
});

describe('inboxPathOf', () => {
  it('is /inbox for Open without a message', () => {
    expect(inboxPathOf({ filter: 'open' })).toBe('/inbox');
  });

  it('keeps another filter and the open message in the URL', () => {
    const deliveryId = newId('delivery');

    expect(inboxPathOf({ filter: 'done', deliveryId })).toBe(`/inbox?filter=done&message=${deliveryId}`);
  });
});

describe('plainMessagesOf', () => {
  it('leaves out the messages that carry questions, which have their own page', () => {
    const plain = { deliveryId: newId('delivery') };
    const asking = { deliveryId: newId('delivery') };

    expect(plainMessagesOf([plain, asking], new Set([asking.deliveryId]))).toEqual([plain]);
  });
});

describe('the open work in argo\'s inbox with stale questions', () => {
  const asker = { id: newId('ship'), name: 'implementer-b' };

  function aMessageToArgo({ contentType, payload, sentAt }: { contentType: string; payload: unknown; sentAt: string }): InboxMessage {
    return {
      deliveryId: newId('delivery'),
      state: 'pending',
      readAt: null,
      doneAt: null,
      repliedWith: null,
      replies: [],
      message: { id: newId('message'), sender: asker, inReplyTo: null, sentAt, contentType, model: 'claude-opus-5-5', payload: typeof payload === 'string' ? payload : JSON.stringify(payload) },
    };
  }

  function aQuestion(id: string, title: string) {
    return { id, title, context: '', options: [{ key: 1, label: 'Keep 3000', detail: '' }], pick: { option: 1, why: 'Nothing else needs it.' } };
  }

  const withdrawnQuestion = aQuestion('3f1c2a9e-7b4d-4e8a-9c1f-2d6b8e0a5c47', 'Which port?');
  const replacedQuestion = aQuestion('5c8e1a3b-6d2f-4b7a-9e0c-3a5d7f9b1c2e', 'Rename the inbox filter?');
  const newQuestion = aQuestion('9b2e4d6f-1a3c-4e5b-8d7f-0c2a4e6b8d1f', 'Rename the inbox filter, now that core moved?');
  const inbox = [
    aMessageToArgo({ contentType: 'text/plain', payload: 'Deployed.', sentAt: '2026-10-11T09:00:00.000Z' }),
    aMessageToArgo({ contentType: QUESTION_CONTENT_TYPE, payload: withdrawnQuestion, sentAt: '2026-10-11T09:01:00.000Z' }),
    aMessageToArgo({ contentType: QUESTION_CONTENT_TYPE, payload: replacedQuestion, sentAt: '2026-10-11T09:02:00.000Z' }),
    aMessageToArgo({ contentType: WITHDRAWAL_CONTENT_TYPE, payload: { questionId: withdrawnQuestion.id }, sentAt: '2026-10-11T09:03:00.000Z' }),
    aMessageToArgo({ contentType: REPLACEMENT_CONTENT_TYPE, payload: { questionId: replacedQuestion.id, question: newQuestion }, sentAt: '2026-10-11T09:04:00.000Z' }),
  ];
  const questions = questionsIn(inbox);

  it('counts neither a stale question nor its withdrawal as an open message, though their deliveries stay pending', () => {
    expect(filterCounts(plainMessagesOf(inbox, questionDeliveryIdsOf(questions))).open).toBe(1);
  });

  it('counts only the replacement as an open question', () => {
    expect(questionFilterCounts(questions)).toEqual({ open: 1, answered: 0, stale: 2, all: 3 });
  });
});
