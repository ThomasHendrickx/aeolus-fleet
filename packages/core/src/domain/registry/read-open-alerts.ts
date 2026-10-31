import { PAGE_SIZE_DEFAULT, type AlertId } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import { pageOf, type Page } from '../shared/page.js';
import type { ShownAlert } from './alert.js';
import type { FleetListing } from './ports.js';
import type { ReadReachOf } from './read-reach.js';

export type ReadOpenAlerts = (caller: Caller, input?: { cursor?: AlertId; limit?: number }) => Promise<Page<ShownAlert, AlertId>>;

/**
 * Use case: a page of the fleet's open alerts (decision 0071,
 * docs/design/monitoring 4.5): the overview's Open alerts, read beside the
 * ship list, and what the watch reads each pass. Newest first, after the
 * cursor's, PAGE_SIZE_DEFAULT unless the caller asks a size; only the alerts
 * on ships the caller reads (decision 0034). A cleared alert leaves the
 * list; its events stay on the ship's timeline. The caller's scope
 * (fleet:read) is checked before this runs.
 */
export function createReadOpenAlerts(deps: { listing: Pick<FleetListing, 'openAlerts'>; readReach: ReadReachOf }): ReadOpenAlerts {
  return async (caller, input) => {
    const limit = input?.limit ?? PAGE_SIZE_DEFAULT;
    const reach = await deps.readReach(caller);
    // One alert past the page tells whether another page follows.
    const rows = await deps.listing.openAlerts(caller.fleetId, { reach, cursor: input?.cursor, limit: limit + 1 });
    return pageOf(rows, { limit, cursorOf: (alert) => alert.id });
  };
}
