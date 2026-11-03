import type { ShipStatus } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import type { FleetListing } from './ports.js';
import type { ReadReachOf } from './read-reach.js';
import { statusesAsked } from '@aeolus-fleet/common/rules';

/** A type, and how many ships of the statuses asked carry it. */
export interface ShipTypeCount {
  type: string;
  ships: number;
}

export type ListShipTypes = (caller: Caller, input?: { status?: readonly ShipStatus[] }) => Promise<ShipTypeCount[]>;

/**
 * Use case: the types of the ships of the caller's fleet, each once, sorted,
 * with how many ships carry it, for the overview's Type filter: only the ships in the caller's read reach
 * (decision 0034), and only active ones unless the status asks for retired,
 * as `fleet.list` answers them. The caller's scope (fleet:read) is checked
 * before this runs.
 */
export function createListShipTypes(deps: { listing: FleetListing; readReach: ReadReachOf }): ListShipTypes {
  return async (caller, input) => deps.listing.types(caller.fleetId, { reach: await deps.readReach(caller), status: statusesAsked(input?.status) });
}
