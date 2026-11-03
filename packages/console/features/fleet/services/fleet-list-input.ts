import type { FleetListFilter, FleetListSort } from '@aeolus-fleet/common';

import type { FleetView } from './fleet-filter';
import type { FleetSort } from './fleet-sort';

/**
 * The overview bar's search and filters as `fleet.list` and `fleet.harbour`
 * select by them, in the same query as the page (decision 4 of the
 * performance design): the same filter in both views.
 */
export function fleetListFilterOf({ query, filters }: Pick<FleetView, 'query' | 'filters'>): FleetListFilter {
  const needle = query.trim();
  return {
    ...(needle === '' ? {} : { nameQuery: needle }),
    ...(filters.state.length === 0 ? {} : { state: [...filters.state] }),
    ...(filters.type.length === 0 ? {} : { type: [...filters.type] }),
    ...(filters.labelValueIds.length === 0 ? {} : { valueIds: [...filters.labelValueIds] }),
  };
}

/** The list's sort as `fleet.list` orders by it; none keeps the default order. */
export function fleetListSortOf(sort: FleetSort | null): FleetListSort | undefined {
  return sort === null ? undefined : { column: sort.column, direction: sort.direction };
}
