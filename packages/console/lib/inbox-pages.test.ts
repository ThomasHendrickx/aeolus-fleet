import { createIdGenerator, QUESTION_CONTENT_TYPE, WITHDRAWAL_CONTENT_TYPE, type DeliveryId, type InboxMessage } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { inboxEntriesOf } from './inbox-entries';
import { isOpenEntry } from './inbox-entry';
import { mergedInbox, pageEntriesOf, readInboxPagesUntil, type InboxPage } from './inbox-pages';
import type { PluginAnswer } from './plugin-answer';

const newId = createIdGenerator();
const SENDER = { id: newId('ship'), name: 'orchestrator-2' };
const QUESTION = { id: '3f1c2a9e-7b4d-4e8a-9c1f-2d6b8e0a5c47', title: 'Which port?', context: '', options: [{ key: 1, label: 'Keep 3000', detail: '' }], pick: { option: 1, why: '' } };

function aMessage(at: string, message: { contentType?: string; payload?: string; state?: InboxMessage['state'] } = {}): InboxMessage {
  const { contentType = 'text/plain', payload = 'Slice 7 done', state = 'pending' } = message;
  return {
    deliveryId: newId('delivery'),
    state,
    readAt: null,
    doneAt: null,
    repliedWith: null,
    replies: [],
    message: { id: newId('message'), sender: SENDER, inReplyTo: null, sentAt: at, contentType, model: null, payload },
  };
}

/** An inbox the fleet answers page by page, newest first, two to a page, counting the pages it was asked. */
function anInbox(messages: readonly InboxMessage[]) {
  const asked: (DeliveryId | undefined)[] = [];
  const read = (cursor: DeliveryId | undefined): Promise<PluginAnswer<InboxPage>> => {
    asked.push(cursor);
    const start = cursor === undefined ? 0 : messages.findIndex(({ deliveryId }) => deliveryId === cursor) + 1;
    const items = messages.slice(start, start + 2);
    const last = items.at(-1);
    return Promise.resolve({ kind: 'answered', data: { items, nextCursor: start + 2 < messages.length && last ? last.deliveryId : null } });
  };
  return { read, asked };
}

describe('readInboxPagesUntil', () => {
  const messages = ['2026-10-23T09:00:00.000Z', '2026-10-23T08:00:00.000Z', '2026-10-22T23:00:00.000Z', '2026-10-22T22:00:00.000Z', '2026-10-22T21:00:00.000Z'].map((at) => aMessage(at));

  it('reads every page to the end when nothing is enough', async () => {
    const inbox = anInbox(messages);

    const read = await readInboxPagesUntil(inbox.read, { isEnough: () => false });

    expect(read).toEqual({ kind: 'answered', data: { items: messages, nextCursor: null } });
    expect(inbox.asked).toHaveLength(3);
  });

  it('stops at the page that makes the rows enough, and says where the next page starts', async () => {
    const inbox = anInbox(messages);

    const read = await readInboxPagesUntil(inbox.read, { isEnough: (rows) => (rows.at(-1)?.message.sentAt ?? '') < '2026-10-23T00:00:00.000Z' });

    expect(read).toEqual({ kind: 'answered', data: { items: messages.slice(0, 4), nextCursor: messages[3]?.deliveryId } });
  });

  it('answers the refusal of any page', async () => {
    const refused = (): Promise<PluginAnswer<InboxPage>> => Promise.resolve({ kind: 'refused', message: 'The fleet is busy' });

    await expect(readInboxPagesUntil(refused, { isEnough: () => false })).resolves.toEqual({ kind: 'refused', message: 'The fleet is busy' });
  });
});

describe('mergedInbox', () => {
  it('holds each delivery once, newest first', () => {
    const [older, newer] = [aMessage('2026-10-22T09:00:00.000Z'), aMessage('2026-10-23T09:00:00.000Z')];

    expect(mergedInbox([older], [newer, older])).toEqual([newer, older]);
  });
});

describe('pageEntriesOf', () => {
  it("lays out a page with the open rows beside it, so a question on it is stale by a withdrawal the page does not hold", () => {
    const question = aMessage('2026-10-22T09:00:00.000Z', { contentType: QUESTION_CONTENT_TYPE, payload: JSON.stringify(QUESTION) });
    const withdrawal = aMessage('2026-10-23T09:00:00.000Z', { contentType: WITHDRAWAL_CONTENT_TYPE, payload: JSON.stringify({ questionId: QUESTION.id }) });

    const [entry, ...others] = pageEntriesOf({ page: [question], open: [withdrawal], ships: [] });

    expect([entry?.kind === 'question' ? entry.stale?.kind : undefined, others]).toEqual(['withdrawn', []]);
  });

  it('counts a question open whose withdrawal argo marked done: the open rows do not hold the withdrawal', () => {
    const question = aMessage('2026-10-22T09:00:00.000Z', { contentType: QUESTION_CONTENT_TYPE, payload: JSON.stringify(QUESTION) });

    expect(inboxEntriesOf(mergedInbox([question]), []).filter(isOpenEntry)).toHaveLength(1);
  });
});
