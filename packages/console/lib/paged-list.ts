import type { UseInfiniteQueryResult } from '@tanstack/react-query';

/** How many rows a console list asks per page: what fits on a screen. */
export const CONSOLE_PAGE_SIZE = 20;

/**
 * A paged list as the console shows it (decision 4 of
 * docs/design/performance/performance.md): the rows of every page loaded so
 * far, in order, and whether more follow. A failed first page fails the list;
 * a failed later page keeps the rows shown and fails only Load more.
 */
export interface PagedList<Item, Failure> {
  /** Every row loaded so far; undefined until the first page comes. */
  items: Item[] | undefined;
  /** Why the list failed, for the session check; null while it has not. */
  error: Failure | null;
  /** Whether the first page failed: nothing to show. */
  isFailed: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  isLoadMoreFailed: boolean;
  loadMore: () => void;
  retry: () => void;
}

/** What the console takes of an infinite query over a paged procedure. */
export function pagedListOf<Page extends { items: readonly unknown[] }, Failure>(query: UseInfiniteQueryResult<{ pages: readonly Page[] }, Failure>): PagedList<Page['items'][number], Failure> {
  return {
    items: query.data?.pages.flatMap((page) => page.items),
    error: query.error,
    isFailed: query.isError && query.data === undefined,
    hasMore: query.hasNextPage,
    isLoadingMore: query.isFetchingNextPage,
    isLoadMoreFailed: query.isFetchNextPageError,
    loadMore: () => {
      void query.fetchNextPage();
    },
    retry: () => {
      void query.refetch();
    },
  };
}

/**
 * The rows with each id once, where it first shows: a ship live put first
 * (lib/live-fleet.ts, #1173) stays first when Load more brings the page that
 * holds it, until the refresh puts it in its place.
 */
export function uniqueById<Item extends { id: string }>(items: readonly Item[]): Item[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
}

/** The cursor of the page after this one, none on the last page: what an infinite query asks next. */
export function nextCursorOf<Cursor>(page: { nextCursor: Cursor | null }): Cursor | undefined {
  return page.nextCursor ?? undefined;
}
