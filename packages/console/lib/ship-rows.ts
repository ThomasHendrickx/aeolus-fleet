import type { FleetListFilter, LabelValueId, ListedShip, ShipId, ShipOutsideReadReach } from '@aeolus-fleet/common';
import { isInReadReach, matchesShipFilter, statusesAsked, type ShipFilter } from '@aeolus-fleet/common/rules';

import { uniqueById } from './paged-list';

/**
 * A view's ships as its loaded pages hold them, shown: each once, where it
 * first shows, only those the session reads whole (decision 0034), and only
 * those the view's filter selects, by the rule `fleet.list` selects with. A
 * ship's live row stays on the pages until their refresh (lib/live-fleet.ts,
 * #1173); the view shows it only while it matches what the view searches or
 * filters for, and a ship put first stays first when Load more brings its
 * page (Thomas, Q3).
 */
export function shipRowsOf(ships: readonly (ListedShip | ShipOutsideReadReach)[], filter: FleetListFilter): ListedShip[] {
  const selected = shipFilterOf(filter);
  return uniqueById(ships)
    .filter(isInReadReach)
    .filter((ship) => matchesShipFilter(ship, { filter: selected, isInReach: true }));
}

/** The filter as the rule reads it: its ids typed, and the active ships when it asks no status, as `fleet.list` answers. */
function shipFilterOf(filter: FleetListFilter): ShipFilter {
  return {
    ...filter,
    status: statusesAsked(filter.status),
    valueIds: filter.valueIds?.filter(isLabelValueId),
    assignedTo: filter.assignedTo?.filter(isShipId),
    shipIds: filter.shipIds?.filter(isShipId),
    pluginShipIds: filter.pluginShipIds?.filter(isShipId),
  };
}

// The filter's ids come as the caller wrote them (FleetListFilter is the procedure's input), so the browser types them here, without zod.
function isShipId(value: unknown): value is ShipId {
  return typeof value === 'string' && value.startsWith('shp_');
}

function isLabelValueId(value: unknown): value is LabelValueId {
  return typeof value === 'string' && value.startsWith('lbv_');
}
