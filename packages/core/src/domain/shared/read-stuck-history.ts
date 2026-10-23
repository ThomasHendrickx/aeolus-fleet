import { readsMessage, type ReadReachOf } from '../registry/public.js';
import type { Caller } from './caller.js';
import type { Clock } from './clock.js';
import { readStuckHistoryOf } from './health-read.js';
import type { HealthSnapshots } from './health-snapshot.js';
import type { HealthRecords } from './health.js';

export type ReadStuckHistory = (caller: Caller) => Promise<{ at: Date; count: number }[]>;

/**
 * Use case: how many deliveries of the caller's fleet were stuck at each hour of
 * the last 7 days, oldest first, the last one now, for the Health page's trend;
 * counting only the deliveries whose message the caller reads (decision
 * 0034). The caller's scope (fleet:read) is checked before this runs.
 */
export function createReadStuckHistory(deps: { health: HealthRecords; snapshots: HealthSnapshots; clock: Clock; readReach: ReadReachOf }): ReadStuckHistory {
  return async (caller) => {
    const reach = await deps.readReach(caller);
    return readStuckHistoryOf({ records: deps.health, snapshots: deps.snapshots }, {
      fleetId: caller.fleetId,
      now: deps.clock.now(),
      reads: (message) => readsMessage(reach, message),
    });
  };
}
