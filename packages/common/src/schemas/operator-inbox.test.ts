import { describe, expect, it } from 'vitest';

import { createIdGenerator } from '../ids/index.js';
import { PAYLOAD_MAX_BYTES } from './message.js';
import {
  INBOX_FILTERS,
  inboxActionOutputSchema,
  inboxCountOutputSchema,
  inboxMessageInputSchema,
  inboxWithdrawalsInputSchema,
  markDoneInputSchema,
  markReadInputSchema,
  operatorInboxInputSchema,
  operatorInboxOutputSchema,
  replyInputSchema,
  replyOutputSchema,
} from './operator-inbox.js';

const newId = createIdGenerator();
const releaseCaptain = { id: newId('ship'), name: 'release-captain' };
const AT = '2026-10-01T14:30:00.000Z';

describe('operatorInboxInputSchema', () => {
  it('takes the cursor and size of a page beside the filter', () => {
    const input = { filter: 'open', cursor: newId('delivery'), limit: 20 };

    expect(operatorInboxInputSchema.parse(input)).toEqual(input);
  });

  it('refuses a cursor that names no delivery', () => {
    expect(operatorInboxInputSchema.safeParse({ filter: 'open', cursor: newId('message') }).success).toBe(false);
  });

  it('knows the filters Open, Done and All', () => {
    expect(INBOX_FILTERS).toEqual(['open', 'done', 'all']);
  });

  it.each(INBOX_FILTERS)('takes the filter %s', (filter) => {
    expect(operatorInboxInputSchema.parse({ filter })).toEqual({ filter });
  });

  it('refuses another filter', () => {
    expect(operatorInboxInputSchema.safeParse({ filter: 'unread' }).success).toBe(false);
  });
});

/** A last page of the inbox holding the messages. */
const lastPage = (...items: unknown[]) => ({ items, nextCursor: null });

describe('operatorInboxOutputSchema', () => {
  const open = {
    deliveryId: newId('delivery'),
    state: 'pending',
    readAt: null,
    doneAt: null,
    repliedWith: null,
    replies: [],
    message: {
      id: newId('message'),
      sender: releaseCaptain,
      inReplyTo: null,
      sentAt: AT,
      contentType: 'text/plain',
      model: 'claude-opus-5-5',
      payload: 'Release 2.14 is staged on hetzner-2. Promote to production? Reply "go" to promote.',
      isPayloadUnreadable: false,
    },
  };

  it('takes an open message, unread', () => {
    expect(operatorInboxOutputSchema.parse(lastPage(open))).toEqual(lastPage(open));
  });

  it("takes argo's replies to it, each with its content type and payload", () => {
    const replied = { ...open, replies: [{ id: newId('message'), contentType: 'application/json', payload: '{"go":true}', isPayloadUnreadable: false, sentAt: AT }] };

    expect(operatorInboxOutputSchema.parse(lastPage(replied))).toEqual(lastPage(replied));
  });

  it("refuses an entry that does not list argo's replies", () => {
    const withoutReplies = Object.fromEntries(Object.entries(open).filter(([key]) => key !== 'replies'));

    expect(operatorInboxOutputSchema.safeParse(lastPage(withoutReplies)).success).toBe(false);
  });

  it('takes a done message, read, with the reply that made it done', () => {
    const done = { ...open, state: 'acknowledged', readAt: AT, doneAt: AT, repliedWith: newId('message') };

    expect(operatorInboxOutputSchema.safeParse(lastPage(done)).success).toBe(true);
  });

  it('refuses a time that is not ISO 8601', () => {
    expect(operatorInboxOutputSchema.safeParse([{ ...open, readAt: 'today' }]).success).toBe(false);
  });
});

describe('markReadInputSchema', () => {
  it('takes a delivery and whether it is read', () => {
    const input = { deliveryId: newId('delivery'), isRead: false };

    expect(markReadInputSchema.parse(input)).toEqual(input);
  });

  it('refuses without whether it is read', () => {
    expect(markReadInputSchema.safeParse({ deliveryId: newId('delivery') }).success).toBe(false);
  });
});

describe('markDoneInputSchema', () => {
  it('takes a delivery id', () => {
    const input = { deliveryId: newId('delivery') };

    expect(markDoneInputSchema.parse(input)).toEqual(input);
  });
});

describe('replyInputSchema', () => {
  const reply = { deliveryId: newId('delivery'), payload: 'go', idempotencyKey: 'reply-1' };

  it('takes the delivery to argo replied to, the payload and a key', () => {
    expect(replyInputSchema.parse(reply)).toEqual(reply);
  });

  it('takes a payload of 64 KB exactly, and refuses one byte more', () => {
    expect(replyInputSchema.safeParse({ ...reply, payload: 'a'.repeat(PAYLOAD_MAX_BYTES) }).success).toBe(true);
    expect(replyInputSchema.safeParse({ ...reply, payload: 'a'.repeat(PAYLOAD_MAX_BYTES + 1) }).success).toBe(false);
  });

  it('refuses an empty key', () => {
    expect(replyInputSchema.safeParse({ ...reply, idempotencyKey: '' }).success).toBe(false);
  });

  it('takes the content type of the reply', () => {
    const typed = { ...reply, contentType: 'application/vnd.example.answer+json' };

    expect(replyInputSchema.parse(typed)).toEqual(typed);
  });

  it('refuses a content type that is no media type', () => {
    expect(replyInputSchema.safeParse({ ...reply, contentType: 'not a type' }).success).toBe(false);
  });
});

describe('replyOutputSchema', () => {
  it('answers the reply', () => {
    const output = { messageId: newId('message') };

    expect(replyOutputSchema.parse(output)).toEqual(output);
  });
});

describe('inboxActionOutputSchema', () => {
  it('answers nothing: the OK is the answer to mark read and mark done', () => {
    expect(inboxActionOutputSchema.safeParse({}).success).toBe(true);
    expect(inboxActionOutputSchema.safeParse({ readAt: AT }).success).toBe(false);
  });
});

describe('inboxCountOutputSchema', () => {
  it('answers how many messages are open, a whole number from none up', () => {
    expect([0, 12, -1, 1.5].map((open) => inboxCountOutputSchema.safeParse({ open }).success)).toEqual([true, true, false, false]);
  });
});

describe('inboxMessageInputSchema', () => {
  it('takes the delivery of one message to argo', () => {
    const input = { deliveryId: newId('delivery') };

    expect(inboxMessageInputSchema.parse(input)).toEqual(input);
  });

  it('refuses an id that names no delivery', () => {
    expect(inboxMessageInputSchema.safeParse({ deliveryId: newId('message') }).success).toBe(false);
  });
});

describe('inboxWithdrawalsInputSchema', () => {
  it("takes a question's uuid and the cursor and size of a page", () => {
    const input = { questionId: '3f1c2a9e-7b4d-4e8a-9c1f-2d6b8e0a5c47', cursor: newId('delivery'), limit: 20 };

    expect(inboxWithdrawalsInputSchema.parse(input)).toEqual(input);
  });

  it('refuses a question id that is no uuid', () => {
    expect(inboxWithdrawalsInputSchema.safeParse({ questionId: 'which-port' }).success).toBe(false);
  });
});
