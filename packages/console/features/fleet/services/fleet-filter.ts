import type { LabelValueId, ShipStatus } from '@aeolus-fleet/common';

import { AGENT_KIND_WORDS, type AgentKind } from './agent-kind';
import type { FleetSort } from './fleet-sort';
import { crewRequestKeyWord, type CrewRequestKey } from '../../../lib/needs-crew';
import type { ShipInSquadron } from '../../../lib/squadrons-view';

/** The overview filters (docs/design/png/FleetTable.png): status, crew request (#245), kind (#401), type, squadron (with squadrons on), labels (#102) and Show retired. */
/** The status filter's values: retired ships have Show retired instead. */
export type StatusFilter = Exclude<ShipStatus, 'retired'>;

/**
 * The overview filters (docs/design/png/FleetTable.png): status, crew request (#245), kind (#401), type, squadron (with squadrons on), labels (#102) and Show retired.
 * Each of status, crew request, kind, type and squadron holds the values picked, in the order picked: a ship
 * matches any of them; none picked is no filter (#815). A ship is shown when it matches every filter in force,
 * as `fleet.list` selects it (fleet-list-input).
 */
export interface FleetFilters {
  status: readonly StatusFilter[];
  /** Where a ship's crew request stands. */
  crewRequest: readonly CrewRequestKey[];
  /** What sort of agent crews a shown ship. */
  kind: readonly AgentKind[];
  /** Ship types. */
  type: readonly string[];
  /** Squadron ids: their flagships and members only. */
  squadron: readonly string[];
  isRetiredShown: boolean;
  /** The label values a shown ship carries, every one (decision 0031), in the order picked; none for all ships. */
  labelValueIds: readonly LabelValueId[];
}

/** What the overview shows: the search text, the filters and the column it is sorted by, if any. Kept in the URL. */
export interface FleetView {
  query: string;
  filters: FleetFilters;
  /** The column the operator sorted by; null keeps the default order. */
  sort: FleetSort | null;
}

export const DEFAULT_FLEET_VIEW: FleetView = {
  query: '',
  filters: { status: [], crewRequest: [], kind: [], type: [], squadron: [], isRetiredShown: false, labelValueIds: [] },
  sort: null,
};

/** URL parameter names; defaults are left out, so a clean overview has a clean URL. A filter repeats its parameter once for each value picked. */
export const PARAMS = { query: 'q', status: 'status', crewRequest: 'crew', kind: 'kind', type: 'type', squadron: 'squadron', isRetiredShown: 'retired', labelValueIds: 'label', sort: 'sort', order: 'order' } as const;
export const RETIRED_SHOWN = '1';
/** The `order` value for Z to A; A to Z is the default and left out. */
export const DESCENDING = 'desc';

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
  const repeated = [
    [PARAMS.status, view.filters.status],
    [PARAMS.crewRequest, view.filters.crewRequest],
    [PARAMS.kind, view.filters.kind],
    [PARAMS.type, view.filters.type],
    [PARAMS.squadron, view.filters.squadron],
  ] as const;
  for (const [name, values] of repeated) {
    for (const value of values) {
      params.append(name, value);
    }
  }
  if (view.filters.isRetiredShown) {
    params.set(PARAMS.isRetiredShown, RETIRED_SHOWN);
  }
  for (const valueId of view.filters.labelValueIds) {
    params.append(PARAMS.labelValueIds, valueId);
  }
  if (view.sort !== null) {
    params.set(PARAMS.sort, view.sort.column);
    if (view.sort.direction === 'descending') {
      params.set(PARAMS.order, DESCENDING);
    }
  }
  return params;
}

/** The squadrons ships belong to, for the squadron filter, sorted. */
export function fleetSquadrons(squadronsOf: ReadonlyMap<string, ShipInSquadron>): string[] {
  return [...new Set([...squadronsOf.values()].map((ship) => ship.squadronId))].toSorted((first, second) => first.localeCompare(second));
}

export const STATUS_WORDS: Record<StatusFilter, string> = { crewed: 'Crewed', awaitingCrew: 'Awaiting crew' };

/** How many filters are in force: each one in words, however many values it has picked, and each label value picked. */
export function activeFilterCount(filters: FleetFilters): number {
  return activeFilterLabels(filters).length + filters.labelValueIds.length;
}

/** A filter in words with every value picked, in the order picked: "Kind: Codex, Claude Code"; none while nothing is picked. */
function filterWords(name: string, words: readonly string[]): string | undefined {
  return words.length === 0 ? undefined : `${name}: ${words.join(', ')}`;
}

/**
 * The filters in force, in words, for the phone's chips under the search
 * (canvas, MOverviewFilters): "Status: Crewed", "Crew request: Needs crew", "Kind: Codex, Claude Code", "Type: reviewer",
 * "Squadron: <id>", "Retired shown". None for the defaults. Label values
 * picked show as their own chips.
 */
export function activeFilterLabels(filters: FleetFilters): string[] {
  return [
    filterWords('Status', filters.status.map((status) => STATUS_WORDS[status])),
    filterWords('Crew request', filters.crewRequest.map(crewRequestKeyWord)),
    filterWords('Kind', filters.kind.map((kind) => AGENT_KIND_WORDS[kind])),
    filterWords('Type', filters.type),
    filterWords('Squadron', filters.squadron),
    filters.isRetiredShown ? 'Retired shown' : undefined,
  ].filter((label) => label !== undefined);
}
