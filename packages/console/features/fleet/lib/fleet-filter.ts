import type { LabelValueId, ListedShip, ShipStatus } from '@aeolus-fleet/common';

import { crewRequestStage } from '../../../lib/crew-request';
import { carriesEvery } from '../../../lib/labels';
import { crewRequestKey, crewRequestKeyWord, type CrewRequestKey } from '../../../lib/needs-crew';
import type { ShipInSquadron } from '../../../lib/squadrons-view';

/** The overview filters (docs/design/png/FleetTable.png): status, crew request (#245), type, squadron (with squadrons on), labels (#102) and Show retired. */
export interface FleetFilters {
  status: Exclude<ShipStatus, 'retired'> | 'all';
  /** Where a ship's crew request stands, or `all`. */
  crewRequest: CrewRequestKey | 'all';
  /** A ship type, or `all`. */
  type: string;
  /** A squadron's id: its flagship and members only; or `all`. */
  squadron: string;
  isRetiredShown: boolean;
  /** The label values a shown ship carries, every one (decision 0031), in the order picked; none for all ships. */
  labelValueIds: readonly LabelValueId[];
}

/** What the overview shows: the search text and the filters. Kept in the URL. */
export interface FleetView {
  query: string;
  filters: FleetFilters;
}

export const DEFAULT_FLEET_VIEW: FleetView = {
  query: '',
  filters: { status: 'all', crewRequest: 'all', type: 'all', squadron: 'all', isRetiredShown: false, labelValueIds: [] },
};

/** The view as filtering reads it: with squadrons on, which squadron each ship belongs to. */
export type FilteredView = FleetView & { squadronsOf?: ReadonlyMap<string, ShipInSquadron> };

/** URL parameter names; defaults are left out, so a clean overview has a clean URL. */
export const PARAMS = { query: 'q', status: 'status', crewRequest: 'crew', type: 'type', squadron: 'squadron', isRetiredShown: 'retired', labelValueIds: 'label' } as const;
export const RETIRED_SHOWN = '1';

function matchesQuery(ship: ListedShip, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return needle === '' || ship.name.toLowerCase().includes(needle) || ship.type.toLowerCase().includes(needle);
}

function matchesFilters(ship: ListedShip, view: Pick<FilteredView, 'filters' | 'squadronsOf'>): boolean {
  const { filters, squadronsOf } = view;
  if (ship.status === 'retired' && !filters.isRetiredShown) {
    return false;
  }
  if (filters.squadron !== 'all' && squadronsOf?.get(ship.id)?.squadronId !== filters.squadron) {
    return false;
  }
  if (filters.status !== 'all' && ship.status !== filters.status) {
    return false;
  }
  if (filters.crewRequest !== 'all' && crewRequestKey(crewRequestStage(ship)) !== filters.crewRequest) {
    return false;
  }
  if (!carriesEvery(ship, filters.labelValueIds)) {
    return false;
  }
  return filters.type === 'all' || ship.type === filters.type;
}

/**
 * The ships the overview shows, in its order: argo first, then by name. The
 * order depends on the ships alone, so a live update changes a row in place
 * and never reorders the rows under the pointer. Search and filters apply to
 * argo like any ship. The squadron filter keeps a squadron's flagship and
 * members, as `squadronsOf` names them.
 */
export function filterFleet(ships: readonly ListedShip[], view: FilteredView): ListedShip[] {
  return ships
    .filter((ship) => matchesQuery(ship, view.query) && matchesFilters(ship, view))
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

/** A page's search params as URL parameters, every value of a repeated one kept (the label filter repeats `label`). */
export function urlParamsOf(searchParams: Readonly<Record<string, string | string[] | undefined>>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(searchParams)) {
    for (const each of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      params.append(name, each);
    }
  }
  return params;
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
  if (view.filters.crewRequest !== 'all') {
    params.set(PARAMS.crewRequest, view.filters.crewRequest);
  }
  if (view.filters.type !== 'all') {
    params.set(PARAMS.type, view.filters.type);
  }
  if (view.filters.squadron !== 'all') {
    params.set(PARAMS.squadron, view.filters.squadron);
  }
  if (view.filters.isRetiredShown) {
    params.set(PARAMS.isRetiredShown, RETIRED_SHOWN);
  }
  for (const valueId of view.filters.labelValueIds) {
    params.append(PARAMS.labelValueIds, valueId);
  }
  return params;
}

/** The squadrons ships belong to, for the squadron filter, sorted. */
export function fleetSquadrons(squadronsOf: ReadonlyMap<string, ShipInSquadron>): string[] {
  return [...new Set([...squadronsOf.values()].map((ship) => ship.squadronId))].toSorted((first, second) => first.localeCompare(second));
}

const STATUS_WORDS: Record<Exclude<FleetFilters['status'], 'all'>, string> = { crewed: 'Crewed', awaitingCrew: 'Awaiting crew' };

/** How many filters are in force: each one in words, and each label value picked. */
export function activeFilterCount(filters: FleetFilters): number {
  return activeFilterLabels(filters).length + filters.labelValueIds.length;
}

/**
 * The filters in force, in words, for the phone's chips under the search
 * (canvas, MOverviewFilters): "Status: Crewed", "Crew request: Needs crew", "Type: reviewer",
 * "Squadron: <id>", "Retired shown". None for the defaults. Label values
 * picked show as their own chips.
 */
export function activeFilterLabels(filters: FleetFilters): string[] {
  return [
    filters.status === 'all' ? undefined : `Status: ${STATUS_WORDS[filters.status]}`,
    filters.crewRequest === 'all' ? undefined : `Crew request: ${crewRequestKeyWord(filters.crewRequest)}`,
    filters.type === 'all' ? undefined : `Type: ${filters.type}`,
    filters.squadron === 'all' ? undefined : `Squadron: ${filters.squadron}`,
    filters.isRetiredShown ? 'Retired shown' : undefined,
  ].filter((label) => label !== undefined);
}
