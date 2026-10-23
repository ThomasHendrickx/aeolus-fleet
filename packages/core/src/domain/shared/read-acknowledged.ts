import { readsMessage, type ReadReachOf } from '../registry/public.js';
import type { Caller } from './caller.js';
import type { Clock } from './clock.js';
import { readAcknowledgedOf } from './health-read.js';
import type { HealthSnapshots } from './health-snapshot.js';
import type { Acknowledged, HealthRecords } from './health.js';

export type ReadAcknowledged = (caller: Caller) => Promise<Acknowledged>;

/**
 * Use case: the deliveries of the caller's fleet acknowledged in the last 24 hours,
 * with the median from send to acknowledgement and how many in each hour, for
 * the Health page's delivering line;
 * counting only the deliveries whose message the caller reads (decision
 * 0034). The caller's scope (fleet:read) is checked before this runs.
 */
export function createReadAcknowledged(deps: { health: HealthRecords; snapshots: HealthSnapshots; clock: Clock; readReach: ReadReachOf }): ReadAcknowledged {
  return async (caller) => {
    const reach = await deps.readReach(caller);
    return readAcknowledgedOf({ records: deps.health, snapshots: deps.snapshots }, {
      fleetId: caller.fleetId,
      now: deps.clock.now(),
      reads: (message) => readsMessage(reach, message),
    });
  };
}
