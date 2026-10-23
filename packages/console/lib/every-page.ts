import type { PluginAnswer } from './plugin-answer';

/**
 * Every item of a paged list (decision 4 of the performance design): its
 * first page, then each next page from the cursor the last one answered,
 * until a page answers none. A refused page answers its refusal, and no
 * further page is read.
 */
export async function everyPage<Item, Cursor>(
  readPage: (cursor: Cursor | undefined) => Promise<PluginAnswer<{ items: Item[]; nextCursor: Cursor | null }>>,
): Promise<PluginAnswer<Item[]>> {
  const items: Item[] = [];
  let cursor: Cursor | undefined;
  do {
    const page = await readPage(cursor);
    if (page.kind === 'refused') {
      return page;
    }
    items.push(...page.data.items);
    cursor = page.data.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return { kind: 'answered', data: items };
}
