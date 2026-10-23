import type { ReadReachOf } from '../registry/public.js';
import type { Caller } from './caller.js';
import type { Clock } from './clock.js';
import { readHealthOf } from './health-read.js';
import type { HealthSnapshots } from './health-snapshot.js';
import type { Health, HealthRecords } from './health.js';

export type ReadHealth = (caller: Caller) => Promise<Health>;

/**
 * Use case: the health of the caller's fleet (decision 0042), for the
 * console's Health: its stuck deliveries by cause and place, the trend over
 * the last 7 days and what was acknowledged in the last 24 hours, counting
 * only the deliveries whose message the caller reads, and naming the machine
 * only behind a ship the caller reads (decision 0034). The caller's
 * scope (fleet:read) is checked before this runs.
 */
export function createReadHealth(deps: { health: HealthRecords; snapshots: HealthSnapshots; clock: Clock; readReach: ReadReachOf }): ReadHealth {
  return async (caller) => {
    const reach = await deps.readReach(caller);
    return readHealthOf({ records: deps.health, snapshots: deps.snapshots }, {
      fleetId: caller.fleetId,
      now: deps.clock.now(),
      reach,
    });
  };
}
