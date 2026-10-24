import type { StuckCause } from '@aeolus-fleet/common';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { CONSOLE_PAGE_SIZE, nextCursorOf, pagedListOf } from './paged-list';
import { useTRPC } from './trpc';

/** How often each part of the health reads again by itself: its waits and clocks move with time, not only with events. */
const HEALTH_REFRESH_MS = 60_000;

/*
 * The fleet's health (decision 0042), one read per part that shows it
 * (performance design, decision 2), so a slow part holds up no other. A live
 * change reloads the stuck count, the stuck summary, the stuck places and the
 * acknowledged; each also reads again every minute, since a stall begins by
 * the clock alone.
 */

/** How many deliveries are stuck now and since when the oldest waits: the navigation's count and the overview's card. */
export function useStuckCount() {
  const trpc = useTRPC();
  return useQuery(trpc.fleet.stuckCount.queryOptions(undefined, { refetchInterval: HEALTH_REFRESH_MS }));
}

/** How many deliveries are stuck now and in how many places, in all, per cause and per machine: Health's verdict, cause totals and machines. */
export function useStuckSummary() {
  const trpc = useTRPC();
  return useQuery(trpc.fleet.stuckSummary.queryOptions(undefined, { refetchInterval: HEALTH_REFRESH_MS }));
}

/** The places deliveries are stuck at for one cause, a page at a time, the oldest waiting first; read only while `isAsked`. */
export function useStuckPlaces(cause: StuckCause, isAsked = true) {
  const trpc = useTRPC();
  return pagedListOf(
    useInfiniteQuery(
      trpc.fleet.stuck.infiniteQueryOptions({ cause, limit: CONSOLE_PAGE_SIZE }, { getNextPageParam: nextCursorOf, refetchInterval: HEALTH_REFRESH_MS, enabled: isAsked }),
    ),
  );
}

/** How many deliveries were stuck at each hour of the last 7 days, the last one now: Health's trend. */
export function useStuckHistory() {
  const trpc = useTRPC();
  return useQuery(trpc.fleet.stuckHistory.queryOptions(undefined, { refetchInterval: HEALTH_REFRESH_MS }));
}

/** The deliveries acknowledged in the last 24 hours, with the median: Health's delivering line. */
export function useAcknowledged() {
  const trpc = useTRPC();
  return useQuery(trpc.fleet.acknowledged.queryOptions(undefined, { refetchInterval: HEALTH_REFRESH_MS }));
}
