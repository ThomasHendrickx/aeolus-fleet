import { describe, expect, it } from 'vitest';

import { idSchema } from '../ids/index.js';
import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX, pageInputOf, pageOutputOf } from './page.js';

const eventPage = pageInputOf(idSchema('event'));

describe('pageInputOf', () => {
  it.each([{}, { cursor: 'evt_01m5kgq4ew42bmwnnzhre9tvxs' }, { limit: 1 }, { limit: 500 }])('accepts %j: a cursor and a page size, each optional', (input) => {
    expect(eventPage.safeParse(input).success).toBe(true);
  });

  it.each([
    ['a cursor of another kind', { cursor: 'msg_01m5kgq4ew42bmwnnzhre9tvxs' }],
    ['an empty page', { limit: 0 }],
    ['a page over 500', { limit: 501 }],
  ])('rejects %s', (_label, input) => {
    expect(eventPage.safeParse(input).success).toBe(false);
  });

  it('answers 100 unless told fewer, 500 at most', () => {
    expect([PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX]).toEqual([100, 500]);
  });
});

describe('pageOutputOf', () => {
  it('names no next page on the last one', () => {
    expect(pageOutputOf(idSchema('event'), idSchema('event')).safeParse({ items: [], nextCursor: null }).success).toBe(true);
  });
});
