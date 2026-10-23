/**
 * A page of a list as a history read answers it (decision 4 of
 * docs/design/performance/performance.md): its items, and the cursor the next
 * page starts after, null on the last page. A read that leaves out what the
 * caller does not read keeps the cursor of the last row it looked at, so a
 * page can come short and the next one still goes on from there.
 */
export interface Page<Item, Cursor> {
  items: Item[];
  nextCursor: Cursor | null;
}

/** What a paged query asks: the cursor the last page answered, none for the first, and at most how many rows. */
export interface PageQuery<Cursor> {
  cursor?: Cursor;
  limit: number;
}

/**
 * The page of the first `limit` rows of `rows`, read one past the limit to
 * know whether another page follows, with the cursor of its last row.
 */
export function pageOf<Row, Cursor>(rows: readonly Row[], query: { limit: number; cursorOf: (row: Row) => Cursor }): Page<Row, Cursor> {
  const items = rows.slice(0, query.limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > query.limit && last !== undefined ? query.cursorOf(last) : null };
}
