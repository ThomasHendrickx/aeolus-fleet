'use client';

import type { FleetListFilter, FleetListSort, ListedShip } from '@aeolus-fleet/common';
import { isInReadReach } from '@aeolus-fleet/common/rules';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { LAST_SEEN_REFRESH_MS } from '../../../lib/fleet';
import { CONSOLE_PAGE_SIZE, nextCursorOf, pagedListOf, type PagedList } from '../../../lib/paged-list';
import { useTRPC } from '../../../lib/trpc';
import { fleetCountsOf, isOnlyArgoIn, type FleetCounts } from '../services/fleet-counts';

/**
 * The overview's ships, 20 a page as `fleet.list` selects and orders them for
 * the view, in the same query as the page (decision 4 of the performance
 * design); Load more reads the next. While a new view's first page comes,
 * the last view's rows stay. Only the ships the session reads whole
 * (decision 0034). A filter that selects no ship (null) reads nothing.
 */
export function useFleetPages(filter: FleetListFilter | null, sort: FleetListSort | undefined): PagedList<ListedShip, unknown> {
  const trpc = useTRPC();
  const list = pagedListOf(
    useInfiniteQuery(
      trpc.fleet.list.infiniteQueryOptions(
        { ...filter, sort, limit: CONSOLE_PAGE_SIZE },
        { enabled: filter !== null, getNextPageParam: nextCursorOf, placeholderData: keepPreviousData, refetchInterval: LAST_SEEN_REFRESH_MS },
      ),
    ),
  );
  if (filter === null) {
    return { ...list, items: [], hasMore: false };
  }
  return { ...list, items: list.items?.filter(isInReadReach) };
}

/**
 * The overview's counts (`fleet.shipCounts`): the view's, read with its
 * filter, and the fleet's, read without one; undefined until both are read.
 */
export function useFleetCounts(filter: FleetListFilter | null): { counts: FleetCounts | undefined; isOnlyArgo: boolean } {
  const trpc = useTRPC();
  const view = useQuery(trpc.fleet.shipCounts.queryOptions({ filter: filter ?? {} }, { enabled: filter !== null, placeholderData: keepPreviousData }));
  const fleet = useQuery(trpc.fleet.shipCounts.queryOptions());
  if (fleet.data === undefined) {
    return { counts: undefined, isOnlyArgo: false };
  }
  const isOnlyArgo = isOnlyArgoIn(fleet.data);
  if (filter === null) {
    return { counts: fleetCountsOf({ view: [], fleet: fleet.data }, {}), isOnlyArgo };
  }
  return { counts: view.data === undefined ? undefined : fleetCountsOf({ view: view.data, fleet: fleet.data }, filter), isOnlyArgo };
}
