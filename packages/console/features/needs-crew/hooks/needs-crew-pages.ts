'use client';

import type { ListedShip } from '@aeolus-fleet/common';
import { isInReadReach } from '@aeolus-fleet/common/rules';
import { useInfiniteQuery } from '@tanstack/react-query';

import { LAST_SEEN_REFRESH_MS } from '../../../lib/fleet';
import { CONSOLE_PAGE_SIZE, nextCursorOf, pagedListOf, type PagedList } from '../../../lib/paged-list';
import { useTRPC } from '../../../lib/trpc';

/**
 * The ships on Needs crew (#245), 20 a page, oldest request first, as
 * `fleet.list` selects them with the trierarch plugin connected or without it
 * (decision 4 of the performance design); Load more reads the next. Only the
 * ships the session reads whole (decision 0034).
 */
export function useNeedsCrewPages(plugin: { hasTrierarchs: boolean }): PagedList<ListedShip, unknown> {
  const trpc = useTRPC();
  const list = pagedListOf(
    useInfiniteQuery(
      trpc.fleet.list.infiniteQueryOptions(
        { needsCrew: plugin.hasTrierarchs ? 'withTrierarchs' : 'withoutTrierarchs', sort: { column: 'requested', direction: 'ascending' }, limit: CONSOLE_PAGE_SIZE },
        { getNextPageParam: nextCursorOf, refetchInterval: LAST_SEEN_REFRESH_MS },
      ),
    ),
  );
  return { ...list, items: list.items?.filter(isInReadReach) };
}
