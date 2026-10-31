import type { ShipId } from '@aeolus-fleet/common';

import type { UsageTokensRequest, UsageValuesPage } from '../../../lib/trierarch-plugin-schemas';
import type { UsageBreakdownName, UsageFilterValues } from './usage-state';

/**
 * The Usage page's filters between the three places they live: the URL's state
 * (typed values), the menus (string keys, fed by `usage.values`) and the
 * request to `usage.tokens` (only the breakdowns that narrow). A login not
 * reported is a null value in the state and its own key in a menu.
 */

/** The menu key of a login not reported: no real login is named so. */
const NOT_REPORTED_KEY = '~not-reported';
const NOT_REPORTED_WORDS = 'Not reported';

export interface FilterItem {
  key: string;
  word: string;
  tokens: number;
}

/** The menu's items for the values read so far, in the order the plugin lists them (largest first). */
export function filterItemsOf(page: UsageValuesPage): FilterItem[] {
  return page.values.map((one) => ({ key: one.value ?? NOT_REPORTED_KEY, word: one.name ?? one.value ?? NOT_REPORTED_WORDS, tokens: one.tokens }));
}

/** The menu keys of the values picked. */
export function pickedKeysOf(values: readonly (string | null)[]): string[] {
  return values.map((value) => value ?? NOT_REPORTED_KEY);
}

// The keys come from usage.values, which the plugin checked; the browser types them here, without zod, as lib/ship-rows.ts does.
function isShipId(value: string): value is ShipId {
  return value.startsWith('shp_');
}

/** The filters after one menu's picks changed to `keys`. */
export function filtersAfterPick(filters: UsageFilterValues, pick: { breakdown: UsageBreakdownName; keys: readonly string[] }): UsageFilterValues {
  const { breakdown, keys } = pick;
  switch (breakdown) {
    case 'machine':
    case 'ship':
      return { ...filters, [breakdown]: keys.filter(isShipId) };
    case 'login':
      return { ...filters, login: keys.map((key) => (key === NOT_REPORTED_KEY ? null : key)) };
    case 'harness':
    case 'model':
      return { ...filters, [breakdown]: [...keys] };
  }
}

/** What `usage.tokens` is asked to narrow to: a breakdown with no value is left out. */
export function requestFiltersOf(filters: UsageFilterValues): UsageTokensRequest['filters'] {
  return {
    ...(filters.machine.length === 0 ? {} : { machineShipIds: filters.machine }),
    ...(filters.harness.length === 0 ? {} : { harnesses: filters.harness }),
    ...(filters.model.length === 0 ? {} : { models: filters.model }),
    ...(filters.ship.length === 0 ? {} : { shipIds: filters.ship }),
    ...(filters.login.length === 0 ? {} : { logins: filters.login }),
  };
}

export function hasFilters(filters: UsageFilterValues): boolean {
  return filters.machine.length + filters.harness.length + filters.model.length + filters.ship.length + filters.login.length > 0;
}
