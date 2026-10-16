import type { Health } from '@aeolus-fleet/common';
import { useQuery } from '@tanstack/react-query';

import { useTRPC } from './trpc';

/** How often the health reads again by itself: its waits and clocks move with time, not only with events. */
const HEALTH_REFRESH_MS = 60_000;

/**
 * The fleet's health (decision 0042): where deliveries are stuck now, the
 * 7-day trend and the acknowledged in 24 hours, as the server shaped it. A
 * live change reloads it; it also reads again every minute, since a stall
 * begins by the clock alone.
 */
export function useFleetHealth() {
  const trpc = useTRPC();
  return useQuery(trpc.fleet.health.queryOptions(undefined, { refetchInterval: HEALTH_REFRESH_MS }));
}

/** How many deliveries are stuck now: the navigation count. Undefined until the health is known. */
export function stuckCountOf(health: Pick<Health, 'stuck'> | undefined): number | undefined {
  return health?.stuck.reduce((total, place) => total + place.count, 0);
}

/** The stuck deliveries, for the navigation. */
export function useStuckCount(): number | undefined {
  return stuckCountOf(useFleetHealth().data);
}
