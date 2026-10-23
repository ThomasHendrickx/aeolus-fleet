import { readsMessage, readsShip, type ReadReachOf } from '../registry/public.js';
import type { Caller } from './caller.js';
import type { Clock } from './clock.js';
import { readStuckPlacesOf } from './health-read.js';
import type { HealthSnapshots } from './health-snapshot.js';
import type { StuckPlaceHealth, HealthRecords } from './health.js';

export type ReadStuck = (caller: Caller) => Promise<StuckPlaceHealth[]>;

/**
 * Use case: the deliveries of the caller's fleet stuck now by cause and place,
 * the oldest waiting first, each ship by name with the machine behind it only
 * when the caller reads the ship, for the Health page's causes and machines;
 * counting only the deliveries whose message the caller reads (decision
 * 0034). The caller's scope (fleet:read) is checked before this runs.
 */
export function createReadStuck(deps: { health: HealthRecords; snapshots: HealthSnapshots; clock: Clock; readReach: ReadReachOf }): ReadStuck {
  return async (caller) => {
    const reach = await deps.readReach(caller);
    return readStuckPlacesOf({ records: deps.health, snapshots: deps.snapshots }, {
      fleetId: caller.fleetId,
      now: deps.clock.now(),
      reads: (message) => readsMessage(reach, message),
      readsShip: (shipId) => readsShip(reach, shipId),
    });
  };
}
