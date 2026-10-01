import { createIdGenerator, type ListedMessage, type MessageId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { threadsOf } from './threads';

const newId = createIdGenerator();
const scout = { id: newId('ship'), name: 'scout' };
const planner = { id: newId('ship'), name: 'planner' };

function aMessage(sentAt: string, inReplyTo: MessageId | null = null): ListedMessage {
  return {
    id: newId('message'),
    sender: scout,
    recipient: { kind: 'ship', ship: planner },
    inReplyTo,
    sentAt: `2026-10-01T${sentAt}:00.000Z`,
    contentType: 'text/plain',
    preview: 'hello',
    delivery: { id: newId('delivery'), state: 'pending', claimedBy: null },
  };
}

function ids(threads: ReturnType<typeof threadsOf>): string[][] {
  return threads.map((thread) => thread.messages.map((message) => message.id));
}

describe('threadsOf', () => {
  it('puts a reply in the thread of the message it answers, oldest first', () => {
    const question = aMessage('09:00');
    const answer = aMessage('09:05', question.id);
    const followUp = aMessage('09:10', answer.id);

    expect(ids(threadsOf([followUp, question, answer]))).toEqual([[question.id, answer.id, followUp.id]]);
  });

  it('starts a thread for a message that answers none', () => {
    const first = aMessage('09:00');
    const second = aMessage('09:05');

    expect(ids(threadsOf([first, second]))).toEqual([[second.id], [first.id]]);
  });

  it('starts a thread for a reply whose message is not on the page', () => {
    const reply = aMessage('09:00', newId('message'));

    expect(threadsOf([reply])).toEqual([{ id: reply.id, messages: [reply], lastSentAt: reply.sentAt }]);
  });

  it('orders threads by their latest message, newest first', () => {
    const old = aMessage('08:00');
    const recent = aMessage('09:00');
    const lateReply = aMessage('10:00', old.id);

    expect(ids(threadsOf([old, recent, lateReply]))).toEqual([[old.id, lateReply.id], [recent.id]]);
  });

  it('has no threads without messages', () => {
    expect(threadsOf([])).toEqual([]);
  });
});
