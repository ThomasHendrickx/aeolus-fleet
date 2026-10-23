import { z } from 'zod';

/**
 * A page of a list (decision 4 of docs/design/performance/performance.md):
 * by cursor on the list's time-ordered id, never by offset, so a page costs
 * the same however long the list grows.
 */

/** A page's size when the caller asks none. */
export const PAGE_SIZE_DEFAULT = 100;

/** The most one page may hold. */
export const PAGE_SIZE_MAX = 500;

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
