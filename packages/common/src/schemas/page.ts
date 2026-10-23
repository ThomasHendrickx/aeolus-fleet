import { z } from 'zod';

import { PAGE_SIZE_MAX } from '../rules/page-size.js';

/**
 * A page of a list (decision 4 of docs/design/performance/performance.md):
 * by cursor on the list's time-ordered id, never by offset, so a page costs
 * the same however long the list grows.
 */

export { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from '../rules/page-size.js';

/**
 * Input of a paged list: the cursor the last page answered, none for the
 * first page, and the page size the caller asks, at most PAGE_SIZE_MAX.
 */
export function pageInputOf<Cursor extends z.ZodType>(cursor: Cursor) {
  return z.object({ cursor: cursor.optional(), limit: z.int().min(1).max(PAGE_SIZE_MAX).optional() });
}

/** Output of a paged list: the page, and the cursor the next page starts after; null on the last page. */
export function pageOutputOf<Item extends z.ZodType, Cursor extends z.ZodType>(item: Item, cursor: Cursor) {
  return z.object({ items: z.array(item), nextCursor: cursor.nullable() });
}
