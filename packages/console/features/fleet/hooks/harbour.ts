'use client';

import { PAGE_SIZE_MAX } from '@aeolus-fleet/common/rules';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { nextCursorOf } from '../../../lib/paged-list';
import { useTRPC } from '../../../lib/trpc';
import { harbourGroupsOf, type Harbour } from '../services/harbour';

/**
 * Harbour (docs/design/fleet-overview, "The read Harbour needs"):
 * `fleet.harbour` 500 tiles a page, every page read on from the last one's
 * cursor until none follows (7 at 3,000 ships), with the numbers the first
 * page holds. A live event reloads only its ship's tile and the numbers
 * (lib/live-fleet.ts); a resync reads it whole again; no interval refresh.
 * Undefined until every page is read; a failed page fails it, with a retry.
 */
export function useHarbour(): { harbour: Harbour | undefined; isFailed: boolean; retry: () => void } {
  const trpc = useTRPC();
  const query = useInfiniteQuery(trpc.fleet.harbour.infiniteQueryOptions({ limit: PAGE_SIZE_MAX }, { getNextPageParam: nextCursorOf }));
  const { hasNextPage, isFetching, isError, fetchNextPage } = query;

  // Harbour shows every ship: read the next page as soon as the last one came.
  useEffect(() => {
    if (hasNextPage && !isFetching && !isError) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetching, isError, fetchNextPage]);

  const counts = query.data?.pages[0]?.counts;
  const isComplete = query.data !== undefined && !hasNextPage && counts !== undefined && counts !== null;
  return {
    harbour: isComplete ? { counts, groups: harbourGroupsOf(query.data.pages.flatMap((page) => page.items)) } : undefined,
    isFailed: isError,
    retry: () => {
      void query.refetch();
    },
  };
}
