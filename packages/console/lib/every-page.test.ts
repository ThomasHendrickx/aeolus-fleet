import { describe, expect, it } from 'vitest';

import { everyPage } from './every-page';
import type { PluginAnswer } from './plugin-answer';

interface Page {
  items: string[];
  nextCursor: string | null;
}

/** A paged list of the items given, `size` a page, read by cursor on the item itself; with the cursors it was asked for. */
function pagedList(items: readonly string[], size: number) {
  const asked: (string | undefined)[] = [];
  const readPage = (cursor: string | undefined): Promise<PluginAnswer<Page>> => {
    asked.push(cursor);
    const start = cursor === undefined ? 0 : items.indexOf(cursor) + 1;
    const page = items.slice(start, start + size);
    return Promise.resolve({ kind: 'answered', data: { items: page, nextCursor: start + size < items.length ? (page.at(-1) ?? null) : null } });
  };
  return { readPage, asked };
}

describe('everyPage', () => {
  it('reads page after page from each next cursor, and answers every item in order', async () => {
    const list = pagedList(['a', 'b', 'c', 'd', 'e'], 2);

    const answer = await everyPage(list.readPage);

    expect([answer, list.asked]).toEqual([{ kind: 'answered', data: ['a', 'b', 'c', 'd', 'e'] }, [undefined, 'b', 'd']]);
  });

  it('reads one page when the first is the last', async () => {
    const list = pagedList(['a'], 2);

    await expect(everyPage(list.readPage)).resolves.toEqual({ kind: 'answered', data: ['a'] });
  });

  it('answers the refusal of a page, and reads no further', async () => {
    const asked: (string | undefined)[] = [];
    const answer = await everyPage((cursor): Promise<PluginAnswer<Page>> => {
      asked.push(cursor);
      return Promise.resolve(cursor === undefined ? { kind: 'answered', data: { items: ['a'], nextCursor: 'a' } } : { kind: 'refused', message: 'The fleet did not answer' });
    });

    expect([answer, asked]).toEqual([{ kind: 'refused', message: 'The fleet did not answer' }, [undefined, 'a']]);
  });
});
