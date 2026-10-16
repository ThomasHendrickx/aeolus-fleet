import { createIdGenerator } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { inboxPathOf, readInboxFilter } from './inbox';

const newId = createIdGenerator();

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
