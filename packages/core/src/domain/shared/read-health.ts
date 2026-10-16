import type { Caller } from './caller.js';
import type { Clock } from './clock.js';
import { acknowledgedSince, healthOf, healthSince, type Health, type HealthRecords } from './health.js';

export type ReadHealth = (caller: Caller) => Promise<Health>;

/**
 * Use case: the health of the caller's fleet (decision 0042), for the
 * console's Health: its stuck deliveries by cause and place, the trend over
 * the last 7 days and what was acknowledged in the last 24 hours. The caller's
 * scope (fleet:read) is checked before this runs.
 */
export function createReadHealth(deps: { health: HealthRecords; clock: Clock }): ReadHealth {
  return async (caller) => {
    const now = deps.clock.now();
    const [facts, acknowledged] = await Promise.all([
      deps.health.read(caller.fleetId, healthSince(now)),
      deps.health.acknowledged(caller.fleetId, acknowledgedSince(now)),
    ]);
    return healthOf(facts, { acknowledged, now });
  };
}
