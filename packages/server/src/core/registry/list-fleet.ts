import type { ShipId, ShipStatus } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import type { FleetListing } from './ports.js';
import { shipStatus } from './ship.js';

/** A ship as the fleet snapshot shows it. */
export interface ListedShip {
  id: ShipId;
  name: string;
  type: string;
  status: ShipStatus;
  /**
   * The starting prompt holding the ship's valid secret: when it was issued
   * and whether a session has claimed the ship with it. Null when no secret is
   * valid. An unclaimed one is outstanding: a new prompt would stop it working.
   */
  startingPrompt: { issuedAt: Date; isClaimed: boolean } | null;
}

export type ListFleet = (caller: Caller) => Promise<ListedShip[]>;

/**
 * Use case: every ship of the caller's fleet, `argo` included, oldest first.
 * Never a secret or its hash. The caller's scope (fleet:read) is checked
 * before this runs.
 */
export function createListFleet(deps: { listing: FleetListing }): ListFleet {
  return async (caller) =>
    (await deps.listing.ships(caller.fleetId)).map(({ ship, isCrewed, validSecret }) => ({
      id: ship.id,
      name: ship.name,
      type: ship.type,
      status: shipStatus(ship, { isCrewed }),
      startingPrompt: validSecret && { issuedAt: validSecret.issuedAt, isClaimed: validSecret.claimedAt !== null },
    }));
}
