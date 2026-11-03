'use client';

import type { HarbourInput } from '@aeolus-fleet/common';
import { PAGE_SIZE_MAX } from '@aeolus-fleet/common/rules';
import type { HarbourCounts } from '@aeolus-fleet/ui';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { nextCursorOf } from '../../../lib/paged-list';
import { useTRPC } from '../../../lib/trpc';
import { harbourGroupsOf, type HarbourGroup } from '../services/harbour';

/** The bar's search and filters as `fleet.harbour` reads them. */
export type HarbourFilter = NonNullable<NonNullable<HarbourInput>['filter']>;

/**
 * Harbour's tiles for the cards (docs/design/fleet-overview, "The read
 * Harbour needs"): `fleet.harbour` with the bar's filter, 500 tiles a page,
 * every page read on from the last one's cursor until none follows. A live
 * event reloads only its ship's tile (lib/live-fleet.ts); a resync reads it
 * whole again; no interval refresh. While a new pick's tiles come, the last
 * ones stay, updating. Undefined until every page is read; a failed page
 * fails it, with a retry.
 */
export function useHarbour(filter: HarbourFilter, isEnabled: boolean): {
  groups: HarbourGroup[] | undefined;
  /** How many tiles the filter selects. */
  shown: number | undefined;
  isUpdating: boolean;
  isFailed: boolean;
  error: unknown;
  retry: () => void;
} {
  const trpc = useTRPC();
  const query = useInfiniteQuery(
    trpc.fleet.harbour.infiniteQueryOptions(
      { limit: PAGE_SIZE_MAX, filter },
      { enabled: isEnabled, getNextPageParam: nextCursorOf, placeholderData: keepPreviousData },
    ),
  );
  const { hasNextPage, isFetching, isError, fetchNextPage } = query;

  // Harbour shows every ship the filter selects: read the next page as soon as the last one came.
  useEffect(() => {
    if (isEnabled && hasNextPage && !isFetching && !isError) {
      void fetchNextPage();
    }
  }, [isEnabled, hasNextPage, isFetching, isError, fetchNextPage]);

  const tiles = query.data !== undefined && !hasNextPage ? query.data.pages.flatMap((page) => page.items) : undefined;
  return {
    groups: tiles && harbourGroupsOf(tiles),
    shown: tiles?.length,
    isUpdating: query.isPlaceholderData,
    isFailed: isError,
    error: query.error,
    retry: () => {
      void query.refetch();
    },
  };
}

/**
 * Harbour's numbers for the whole fleet, whatever the bar picks (Thomas,
 * #1605: the numbers are the fleet snapshot): the first page of
 * `fleet.harbour` without a filter, one tile long. A live event reads them
 * again (lib/live-fleet.ts).
 */
export function useHarbourNumbers(): { counts: HarbourCounts | undefined; isFailed: boolean; error: unknown; retry: () => void } {
  const trpc = useTRPC();
  const query = useQuery(trpc.fleet.harbour.queryOptions({ limit: 1 }));
  return {
    counts: query.data?.counts ?? undefined,
    isFailed: query.isError,
    error: query.error,
    retry: () => {
      void query.refetch();
    },
  };
}
