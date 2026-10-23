import { readsMessage, type ReadReachOf } from '../registry/public.js';
import type { Caller } from './caller.js';
import type { Clock } from './clock.js';
import { readStuckNowOf } from './health-read.js';
import type { HealthSnapshots } from './health-snapshot.js';
import type { HealthRecords } from './health.js';

/** How many deliveries are stuck now, and since when the oldest of them waits; none when nothing is stuck. */
export interface StuckNowCount {
  count: number;
  oldestSince: Date | null;
}

export type ReadStuckCount = (caller: Caller) => Promise<StuckNowCount>;

/**
 * Use case: how many deliveries of the caller's fleet are stuck now, of every
 * cause and place, and since when the oldest waits, for the navigation and the
 * overview; counting only the deliveries whose message the caller reads
 * (decision 0034). The caller's scope (fleet:read) is checked before this runs.
 */
export function createReadStuckCount(deps: { health: HealthRecords; snapshots: HealthSnapshots; clock: Clock; readReach: ReadReachOf }): ReadStuckCount {
  return async (caller) => {
    const reach = await deps.readReach(caller);
    const stuck = await readStuckNowOf({ records: deps.health, snapshots: deps.snapshots }, {
      fleetId: caller.fleetId,
      now: deps.clock.now(),
      reads: (message) => readsMessage(reach, message),
    });
    const [oldest] = stuck.map((delivery) => delivery.since).toSorted((first, second) => first.getTime() - second.getTime());
    return { count: stuck.length, oldestSince: oldest ?? null };
  };
}
