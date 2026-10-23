import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { createIdGenerator, idSchema } from '../ids/index.js';
import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX, pageInputOf, pageOutputOf } from './page.js';

const newId = createIdGenerator();
const shipPageInput = pageInputOf(idSchema('ship'));
const shipPageOutput = pageOutputOf(z.object({ id: idSchema('ship') }), idSchema('ship'));

describe('the page size (decision 4 of the performance design)', () => {
  it('is 100 when the caller asks none, and at most 500', () => {
    expect([PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX]).toEqual([100, 500]);
  });
});

describe('pageInputOf', () => {
  it('takes no cursor and no size for the first page', () => {
    expect(shipPageInput.parse({})).toEqual({});
  });

  it('takes the cursor the last page answered and the size the caller asks', () => {
    const cursor = newId('ship');

    expect(shipPageInput.parse({ cursor, limit: 25 })).toEqual({ cursor, limit: 25 });
  });

  it('takes a page of the maximum size', () => {
    expect(shipPageInput.parse({ limit: 500 })).toEqual({ limit: 500 });
  });

  it.each([0, 501, 2.5])('refuses a page size of %j', (limit) => {
    expect(shipPageInput.safeParse({ limit }).success).toBe(false);
  });

  it('refuses a cursor that is not the list\'s id', () => {
    expect(shipPageInput.safeParse({ cursor: newId('message') }).success).toBe(false);
  });
});

describe('pageOutputOf', () => {
  it('answers the page and the cursor of the next, null on the last', () => {
    const page = { items: [{ id: newId('ship') }], nextCursor: newId('ship') };

    expect(shipPageOutput.parse(page)).toEqual(page);
    expect(shipPageOutput.parse({ items: [], nextCursor: null })).toEqual({ items: [], nextCursor: null });
  });
});
