import { shipStatusSchema, type ListedShip, type ShipStatus } from '@aeolus-fleet/common';

/** The overview filters (docs/design/png/FleetTable.png): status, type and Show retired. */
export interface FleetFilters {
  status: Exclude<ShipStatus, 'retired'> | 'all';
  /** A ship type, or `all`. */
  type: string;
  isRetiredShown: boolean;
}

/** What the overview shows: the search text and the filters. Kept in the URL. */
export interface FleetView {
  query: string;
  filters: FleetFilters;
}

export const DEFAULT_FLEET_VIEW: FleetView = {
  query: '',
  filters: { status: 'all', type: 'all', isRetiredShown: false },
};

/** URL parameter names; defaults are left out, so a clean overview has a clean URL. */
const PARAMS = { query: 'q', status: 'status', type: 'type', isRetiredShown: 'retired' } as const;
const RETIRED_SHOWN = '1';

function matchesQuery(ship: ListedShip, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return needle === '' || ship.name.toLowerCase().includes(needle) || ship.type.toLowerCase().includes(needle);
}

function matchesFilters(ship: ListedShip, filters: FleetFilters): boolean {
  if (ship.status === 'retired' && !filters.isRetiredShown) {
    return false;
  }
  if (filters.status !== 'all' && ship.status !== filters.status) {
    return false;
  }
  return filters.type === 'all' || ship.type === filters.type;
}

/**
 * The ships the overview shows, in its order: argo first, then by name. The
 * order depends on the ships alone, so a live update changes a row in place
 * and never reorders the rows under the pointer. Search and filters apply to
 * argo like any ship.
 */
export function filterFleet(ships: readonly ListedShip[], view: FleetView): ListedShip[] {
  return ships
    .filter((ship) => matchesQuery(ship, view.query) && matchesFilters(ship, view.filters))
    .toSorted((first, second) => {
      if (first.kind !== second.kind) {
        return first.kind === 'operator' ? -1 : 1;
      }
      return first.name.localeCompare(second.name) || first.id.localeCompare(second.id);
    });
}

/** The types in the fleet, for the type filter, sorted. Retired ships count only while shown. */
export function fleetTypes(ships: readonly ListedShip[], isRetiredShown: boolean): string[] {
  const types = ships.filter((ship) => isRetiredShown || ship.status !== 'retired').map((ship) => ship.type);
  return [...new Set(types)].toSorted((first, second) => first.localeCompare(second));
}

/** How many retired ships there are, for "Show retired (1)". */
export function retiredCount(ships: readonly ListedShip[]): number {
  return ships.filter((ship) => ship.status === 'retired').length;
}

function readStatus(value: string | null): FleetFilters['status'] {
  const parsed = shipStatusSchema.safeParse(value);
  return parsed.success && parsed.data !== 'retired' ? parsed.data : 'all';
}

/** Reads the overview's view from the URL; anything unknown falls back to the default. */
export function readFleetView(params: URLSearchParams): FleetView {
  return {
    query: params.get(PARAMS.query) ?? '',
    filters: {
      status: readStatus(params.get(PARAMS.status)),
      type: params.get(PARAMS.type) ?? 'all',
      isRetiredShown: params.get(PARAMS.isRetiredShown) === RETIRED_SHOWN,
    },
  };
}

/** Writes the view as URL parameters, leaving out every default. */
export function fleetViewParams(view: FleetView): URLSearchParams {
  const params = new URLSearchParams();
  if (view.query !== '') {
    params.set(PARAMS.query, view.query);
  }
  if (view.filters.status !== 'all') {
    params.set(PARAMS.status, view.filters.status);
  }
  if (view.filters.type !== 'all') {
    params.set(PARAMS.type, view.filters.type);
  }
  if (view.filters.isRetiredShown) {
    params.set(PARAMS.isRetiredShown, RETIRED_SHOWN);
  }
  return params;
}
