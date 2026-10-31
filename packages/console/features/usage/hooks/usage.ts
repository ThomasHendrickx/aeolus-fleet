'use client';

import { useInfiniteQuery } from '@tanstack/react-query';

import { fetchConsoleRead } from '../../../lib/fetch-console-read';
import { nextCursorOf } from '../../../lib/paged-list';
import { useSignInWhenSessionEnds } from '../../../lib/session';
import { useTrierarchPluginConnection } from '../../../lib/trierarch-plugin';
import type { UsageTokensRequest, UsageValuesPage, UsageValuesRequest } from '../../../lib/trierarch-plugin-schemas';
import { useConsoleRead } from '../../../lib/console-read-query';

/**
 * The Usage page's reads from the trierarch plugin: `usage.tokens` for the
 * chart and `usage.values` for the filters and for the machines sending no
 * usage. Both are console reads (lib/console-reads.ts), asked only while the
 * plugin is connected, and read again when the range, split, measure or a
 * filter changes (they are part of the key).
 */

/** How long a read of usage stays fresh: a trierarch sends once an hour (U13), so a minute is never behind. */
const USAGE_STALE_MS = 60_000;

/** Token usage for a request. */
export function useUsageTokens(request: UsageTokensRequest) {
  const isConnected = useTrierarchPluginConnection() === 'connected';
  return useConsoleRead({
    queryKey: ['trierarch-plugin', 'usage-tokens', request],
    queryFn: () => fetchConsoleRead({ read: 'usage-tokens', input: request }),
    enabled: isConnected,
    staleTime: USAGE_STALE_MS,
    retry: false,
  });
}

const FIRST_PAGE: string | null = null;

/** One breakdown's values in a range, 20 a page and more when asked; every page read so far as one page. */
export function useUsageValues(request: Pick<UsageValuesRequest, 'from' | 'to' | 'breakdown'>) {
  const isConnected = useTrierarchPluginConnection() === 'connected';
  const query = useInfiniteQuery({
    queryKey: ['trierarch-plugin', 'usage-values', request],
    queryFn: ({ pageParam }) => fetchConsoleRead({ read: 'usage-values', input: { ...request, cursor: pageParam } }),
    initialPageParam: FIRST_PAGE,
    getNextPageParam: nextCursorOf,
    enabled: isConnected,
    staleTime: USAGE_STALE_MS,
    retry: false,
  });
  useSignInWhenSessionEnds([query.error]);
  const last = query.data?.pages.at(-1);
  const loaded: UsageValuesPage | undefined = last === undefined ? undefined : { values: query.data?.pages.flatMap((page) => page.values) ?? [], nextCursor: last.nextCursor };
  return {
    page: loaded,
    isFailed: query.isError && loaded === undefined,
    isLoadingMore: query.isFetchingNextPage,
    loadMore: () => {
      void query.fetchNextPage();
    },
  };
}
