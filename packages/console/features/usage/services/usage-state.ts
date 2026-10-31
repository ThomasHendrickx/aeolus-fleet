import type { ShipId } from '@aeolus-fleet/common';

import { USAGE_RANGES, type UsageRange } from './usage-window';

/**
 * What the Usage page keeps in its URL (web-frontend: view state in search
 * params), so a link can open it filtered: the range, the split, the measure,
 * the table view and a filter per breakdown. Only what differs from how the
 * page opens is written. Ship ids are parsed by the server and handed in: the
 * browser imports no zod.
 */

export const USAGE_SPLITS = ['machine', 'harness', 'model', 'ship', 'login', 'kind'] as const;
export type UsageSplit = (typeof USAGE_SPLITS)[number];

export const USAGE_MEASURES = ['tokens', 'cost'] as const;
export type UsageMeasure = (typeof USAGE_MEASURES)[number];

/** The values usage is narrowed to, per breakdown; none is no filter. A null login is "not reported". */
export interface UsageFilterValues {
  machine: ShipId[];
  harness: string[];
  model: string[];
  ship: ShipId[];
  login: (string | null)[];
}

export type UsageBreakdownName = keyof UsageFilterValues;

export interface UsageState {
  range: UsageRange;
  splitBy: UsageSplit;
  measure: UsageMeasure;
  filters: UsageFilterValues;
  /** Whether the table shows beside the chart. */
  isTable: boolean;
}

export const DEFAULT_USAGE_STATE: UsageState = {
  range: '7d',
  splitBy: 'machine',
  measure: 'tokens',
  filters: { machine: [], harness: [], model: [], ship: [], login: [] },
  isTable: false,
};

type SearchParameters = Readonly<Record<string, string | readonly string[] | undefined>>;

/** The allowed value a text names, if it names one. */
function choiceOf<T extends string>(allowed: readonly T[], value: string | undefined): T | undefined {
  return allowed.find((candidate) => candidate === value);
}

/** The page's state from the URL's search parameters; what it does not know falls back to how the page opens. */
export function usageStateOf(parameters: SearchParameters, parseShipId: (value: string) => ShipId | undefined): UsageState {
  const valuesOf = (name: string): string[] => {
    const value = parameters[name];
    if (value === undefined) {
      return [];
    }
    return typeof value === 'string' ? [value] : [...value];
  };
  const shipIdsOf = (name: string): ShipId[] => valuesOf(name).flatMap((value) => parseShipId(value) ?? []);
  return {
    range: choiceOf(USAGE_RANGES, valuesOf('range')[0]) ?? DEFAULT_USAGE_STATE.range,
    splitBy: choiceOf(USAGE_SPLITS, valuesOf('split')[0]) ?? DEFAULT_USAGE_STATE.splitBy,
    measure: choiceOf(USAGE_MEASURES, valuesOf('measure')[0]) ?? DEFAULT_USAGE_STATE.measure,
    isTable: valuesOf('view')[0] === 'table',
    filters: {
      machine: shipIdsOf('machine'),
      harness: valuesOf('harness'),
      model: valuesOf('model'),
      ship: shipIdsOf('ship'),
      // An empty login is the one not reported.
      login: valuesOf('login').map((value) => (value === '' ? null : value)),
    },
  };
}

/** The search string for a state, with its question mark, or nothing for the page as it opens. */
export function usageSearchOf(state: UsageState): string {
  const search = new URLSearchParams();
  if (state.range !== DEFAULT_USAGE_STATE.range) {
    search.set('range', state.range);
  }
  if (state.splitBy !== DEFAULT_USAGE_STATE.splitBy) {
    search.set('split', state.splitBy);
  }
  if (state.measure !== DEFAULT_USAGE_STATE.measure) {
    search.set('measure', state.measure);
  }
  if (state.isTable) {
    search.set('view', 'table');
  }
  const { machine, harness, model, ship, login } = state.filters;
  const filters: [string, readonly (string | null)[]][] = [['machine', machine], ['harness', harness], ['model', model], ['ship', ship], ['login', login]];
  for (const [name, values] of filters) {
    for (const value of values) {
      search.append(name, value ?? '');
    }
  }
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
}
