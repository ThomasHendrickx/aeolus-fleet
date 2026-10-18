import { readsMessage, type ReadReachOf } from '../registry/public.js';
import type { Caller } from './caller.js';
import type { Clock } from './clock.js';
import { readHealthOf, type Health, type HealthRecords } from './health.js';

export type ReadHealth = (caller: Caller) => Promise<Health>;

/**
 * Use case: the health of the caller's fleet (decision 0042), for the
 * console's Health: its stuck deliveries by cause and place, the trend over
 * the last 7 days and what was acknowledged in the last 24 hours, counting
 * only the deliveries whose message the caller reads (decision 0034). The caller's
 * scope (fleet:read) is checked before this runs.
 */
export function createReadHealth(deps: { health: HealthRecords; clock: Clock; readReach: ReadReachOf }): ReadHealth {
  return async (caller) => {
    const reach = await deps.readReach(caller);
    return readHealthOf(deps.health, { fleetId: caller.fleetId, now: deps.clock.now(), reads: (message) => readsMessage(reach, message) });
  };
}
