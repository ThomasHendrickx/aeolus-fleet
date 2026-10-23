import type { Caller } from '../shared/caller.js';
import type { FleetListing } from './ports.js';
import type { ReadReachOf } from './read-reach.js';
import type { ShipCounts } from './ship-counts.js';

export type CountShips = (caller: Caller) => Promise<ShipCounts[]>;

/**
 * Use case: the ships of the caller's fleet counted per kind, only those in
 * the caller's read reach (decision 0034), so the counts agree with the list
 * the caller reads. The caller's scope (fleet:read) is checked before this runs.
 */
export function createCountShips(deps: { listing: FleetListing; readReach: ReadReachOf }): CountShips {
  return async (caller) => deps.listing.counts(caller.fleetId, await deps.readReach(caller));
}
