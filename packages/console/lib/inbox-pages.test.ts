import { createIdGenerator, type DeliveryId, type InboxMessage } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { readInboxPagesUntil, type InboxPage } from './inbox-pages';
import type { PluginAnswer } from './plugin-answer';

const newId = createIdGenerator();
const SENDER = { id: newId('ship'), name: 'orchestrator-2' };

function aMessage(at: string): InboxMessage {
  return {
    deliveryId: newId('delivery'),
    state: 'pending',
    readAt: null,
    doneAt: null,
    repliedWith: null,
    replies: [],
    message: { id: newId('message'), sender: SENDER, inReplyTo: null, sentAt: at, contentType: 'text/plain', model: null, payload: 'Slice 7 done' },
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
