'use client';

import { useInfiniteQuery } from '@tanstack/react-query';

import { CONSOLE_PAGE_SIZE, nextCursorOf, pagedListOf } from '../../../lib/paged-list';
import { useTRPC } from '../../../lib/trpc';

/**
 * The reach refusals as argo reads them on Network (design point 7 on #260;
 * decision 0034): the sends the rules refused, newest first, each said as
 * who tried to message whom and what refused it.
 */

/** The fleet's reach refusals, newest first, a page at a time: asked only while Network shows. */
export function useReachRefusals(isShown: boolean) {
  const trpc = useTRPC();
  return pagedListOf(useInfiniteQuery(trpc.fleet.reachRefusals.infiniteQueryOptions({ limit: CONSOLE_PAGE_SIZE }, { enabled: isShown, getNextPageParam: nextCursorOf })));
}
