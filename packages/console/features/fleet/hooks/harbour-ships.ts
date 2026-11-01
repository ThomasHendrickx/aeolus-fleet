'use client';

import type { ListedShip } from '@aeolus-fleet/common';
import { PAGE_SIZE_MAX } from '@aeolus-fleet/common/rules';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { nextCursorOf } from '../../../lib/paged-list';
import { shipRowsOf } from '../../../lib/ship-rows';
import { useTRPC } from '../../../lib/trpc';

/**
 * Every active ship the session reads whole, for Harbour
 * (docs/design/fleet-overview): one tile per ship, so it reads the whole
 * fleet, `fleet.list` 500 a page, each page read on from the last one's
 * cursor until none follows (7 pages at 3,000 ships). Kept as one of the
 * overview's loaded pages, so a live event replaces the ship's row in place
 * (lib/live-fleet.ts) and nothing reads the pages again but a resync. Undefined
 * until every page is read; a failed page fails it, with a retry.
 */
export function useHarbourShips(): { ships: ListedShip[] | undefined; isFailed: boolean; retry: () => void } {
  const trpc = useTRPC();
  const query = useInfiniteQuery(trpc.fleet.list.infiniteQueryOptions({ limit: PAGE_SIZE_MAX }, { getNextPageParam: nextCursorOf }));
  const { hasNextPage, isFetching, isError, fetchNextPage } = query;

  // Harbour shows every ship: read the next page as soon as the last one came.
  useEffect(() => {
    if (hasNextPage && !isFetching && !isError) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetching, isError, fetchNextPage]);

  const isComplete = query.data !== undefined && !hasNextPage;
  return {
    ships: isComplete ? shipRowsOf(query.data.pages.flatMap((page) => page.items), {}) : undefined,
    isFailed: isError,
    retry: () => {
      void query.refetch();
    },
  };
}
