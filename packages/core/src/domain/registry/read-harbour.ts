import { PAGE_SIZE_MAX, type ShipId, type ShipPosition } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import type { HarbourCounts, HarbourShip } from './harbour.js';
import type { FleetListing } from './ports.js';
import type { ReadReachOf } from './read-reach.js';

export type ReadHarbour = (
  caller: Caller,
  input?: { cursor?: ShipPosition; limit?: number } | { shipIds: readonly ShipId[] },
) => Promise<{ ships: HarbourShip[]; nextCursor: ShipPosition | null; counts: HarbourCounts | null }>;

/**
 * Use case: Harbour's ships (docs/design/fleet-overview, "The read Harbour
 * needs"): the active ships the caller reads whole (decision 0034), the
 * viewer ship left out, each by id, name, kind, its state and note, argo
 * first and then by name, PAGE_SIZE_MAX a page unless the caller asks
 * fewer, with where the next page starts; the numbers on the first page
 * only, read with it. With ship ids, only those ships, for the live reload
 * of their tiles: no numbers, no next page. The caller's scope (fleet:read)
 * is checked before this runs.
 */
export function createReadHarbour(deps: { listing: FleetListing; readReach: ReadReachOf }): ReadHarbour {
  return async (caller, input = {}) => {
    const reach = await deps.readReach(caller);
    if ('shipIds' in input) {
      const { ships } = await deps.listing.harbour(caller.fleetId, { reach, shipIds: input.shipIds });
      return { ships: ships.map(({ ship }) => ship), nextCursor: null, counts: null };
    }
    const { cursor, limit = PAGE_SIZE_MAX } = input;
    // One ship past the page tells whether another page follows.
    const { ships, counts } = await deps.listing.harbour(caller.fleetId, { reach, after: cursor, limit: limit + 1 });
    const page = ships.slice(0, limit);
    const last = page.at(-1);
    return { ships: page.map(({ ship }) => ship), nextCursor: ships.length > limit && last !== undefined ? last.position : null, counts };
  };
}
