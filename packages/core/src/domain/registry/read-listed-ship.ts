import type { ShipId } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { listedShipOf, outsideReadReach, type ListedShip, type ShipOutsideReadReach } from './list-fleet.js';
import type { FleetListing } from './ports.js';
import { readsShip, type ReadReachOf } from './read-reach.js';

export type ReadListedShip = (caller: Caller, input: { shipId: ShipId }) => Promise<Result<ListedShip | ShipOutsideReadReach, DomainError<'SHIP_NOT_FOUND'>>>;

/**
 * Use case: one ship of the caller's fleet exactly as the fleet snapshot lists
 * it, retired ones included, so a change to one ship reloads only its row
 * (performance design, decision 3). A ship outside the caller's read reach
 * shows its name, type and status only (decision 0034). The caller's scope
 * (fleet:read) is checked before this runs.
 */
export function createReadListedShip(deps: { listing: FleetListing; readReach: ReadReachOf }): ReadListedShip {
  return async (caller, { shipId }) => {
    const facts = await deps.listing.ship(caller.fleetId, shipId);
    if (!facts) {
      return refuse('SHIP_NOT_FOUND', `No ship ${shipId} in this fleet`);
    }
    const listed = listedShipOf(facts);
    return ok(readsShip(await deps.readReach(caller), shipId) ? listed : outsideReadReach(listed));
  };
}
