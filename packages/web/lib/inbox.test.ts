import { createIdGenerator } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { filterCounts, inboxPathOf, messagesFor, readInboxFilter } from './inbox';

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
