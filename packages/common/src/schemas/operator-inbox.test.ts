import { describe, expect, it } from 'vitest';

import { createIdGenerator } from '../ids/index.js';
import { PAYLOAD_MAX_BYTES } from './message.js';
import {
  INBOX_FILTERS,
  inboxActionOutputSchema,
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

describe('operatorInboxOutputSchema', () => {
  const open = {
    deliveryId: newId('delivery'),
    state: 'pending',
    readAt: null,
    doneAt: null,
    repliedWith: null,
    message: {
      id: newId('message'),
      sender: releaseCaptain,
      inReplyTo: null,
      sentAt: AT,
      contentType: 'text/plain',
      payload: 'Release 2.14 is staged on hetzner-2. Promote to production? Reply "go" to promote.',
    },
  };

  it('takes an open message, unread', () => {
    expect(operatorInboxOutputSchema.parse([open])).toEqual([open]);
  });

  it('takes a done message, read, with the reply that made it done', () => {
    const done = { ...open, state: 'acknowledged', readAt: AT, doneAt: AT, repliedWith: newId('message') };

    expect(operatorInboxOutputSchema.safeParse([done]).success).toBe(true);
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
