import type { LabelValueId } from '@aeolus-fleet/common';
import type { HarbourState } from '@aeolus-fleet/common/rules';

import type { FleetSort } from './fleet-sort';

/** Harbour's states in words, in the order the State filter lists them. */
export const STATE_WORDS: Record<HarbourState, string> = { alert: 'Alert', waiting: 'Waiting', working: 'Working', idle: 'Idle' };

/**
 * The overview bar's filters (docs/design/fleet-overview, "One view: cards or
 * list"): State, Type and Labels, the same in both views. State and Type
 * hold the values picked, in the order picked: a ship matches any of them;
 * none picked is no filter (#815). A ship carries every label value picked
 * (decision 0031). A ship is shown when it matches every filter in force,
 * as `fleet.list` and `fleet.harbour` select it (fleet-list-input).
 */
export interface FleetFilters {
  /** Harbour's states. */
  state: readonly HarbourState[];
  /** Ship types. */
  type: readonly string[];
  labelValueIds: readonly LabelValueId[];
}

/** Which view the overview shows: Harbour's cards, or the fleet table. */
export type FleetViewMode = 'cards' | 'list';

/** What the overview shows: cards or list, the search text, the filters and the list's sort. Kept in the address. */
export interface FleetView {
  mode: FleetViewMode;
  query: string;
  filters: FleetFilters;
  /** The column the operator sorted the list by; null keeps the default order. */
  sort: FleetSort | null;
}

export const DEFAULT_FLEET_VIEW: FleetView = { mode: 'cards', query: '', filters: { state: [], type: [], labelValueIds: [] }, sort: null };

/** Address parameter names; defaults are left out, so `/` is cards with nothing filtered. A filter repeats its parameter once for each value picked. */
export const PARAMS = { mode: 'view', query: 'q', state: 'state', type: 'type', labelValueIds: 'label', sort: 'sort', order: 'order' } as const;
/** The `view` value for the list; cards is the default and left out. */
export const LIST_VIEW = 'list';
/** The `order` value for Z to A; A to Z is the default and left out. */
export const DESCENDING = 'desc';

/** A page's search params as address parameters, every value of a repeated one kept (the label filter repeats `label`). */
export function urlParamsOf(searchParams: Readonly<Record<string, string | string[] | undefined>>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(searchParams)) {
    for (const each of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      params.append(name, each);
    }
  }
  return params;
}

/** Writes the view as address parameters, leaving out every default. */
export function fleetViewParams(view: FleetView): URLSearchParams {
  const params = new URLSearchParams();
  if (view.mode === 'list') {
    params.set(PARAMS.mode, LIST_VIEW);
  }
  if (view.query !== '') {
    params.set(PARAMS.query, view.query);
  }
  const repeated = [
    [PARAMS.state, view.filters.state],
    [PARAMS.type, view.filters.type],
    [PARAMS.labelValueIds, view.filters.labelValueIds],
  ] as const;
  for (const [name, values] of repeated) {
    for (const value of values) {
      params.append(name, value);
    }
  }
  if (view.sort !== null) {
    params.set(PARAMS.sort, view.sort.column);
    if (view.sort.direction === 'descending') {
      params.set(PARAMS.order, DESCENDING);
    }
  }
  return params;
}

/** How many filters are in force: State and Type each once, however many values they have picked, and each label value picked. */
export function activeFilterCount(filters: FleetFilters): number {
  return activeFilterLabels(filters).length + filters.labelValueIds.length;
}

/** A filter in words with every value picked, in the order picked: "State: Alert, Waiting"; none while nothing is picked. */
function filterWords(name: string, words: readonly string[]): string | undefined {
  return words.length === 0 ? undefined : `${name}: ${words.join(', ')}`;
}

/** State and Type in force, in words, for the phone's chips under the search; label values picked show as their own chips. */
export function activeFilterLabels(filters: FleetFilters): string[] {
  return [filterWords('State', filters.state.map((state) => STATE_WORDS[state])), filterWords('Type', filters.type)].filter((label) => label !== undefined);
}

/** Whether the search or a filter narrows the view: the bar's count then says how many of the fleet are shown. */
export function isFiltered(view: Pick<FleetView, 'query' | 'filters'>): boolean {
  return view.query.trim() !== '' || activeFilterCount(view.filters) > 0;
}
