import type { FleetListFilter, FleetListSort, ShipSortColumn } from '@aeolus-fleet/common';

import type { ShipInSquadron } from '../../../lib/squadrons-view';
import type { FleetView } from './fleet-filter';
import type { FleetSort, SortColumn } from './fleet-sort';

/** The column `fleet.list` sorts by for each of the overview's: Squadron and labels sorts by the labels. */
const SORT_COLUMNS_OF: Record<SortColumn, ShipSortColumn> = { ship: 'ship', status: 'status', report: 'report', squadronAndLabels: 'labels', runsOn: 'runsOn', seen: 'seen' };

/**
 * The overview's view as `fleet.list` selects it, in the same query as the
 * page (decision 4 of the performance design). Without a status picked, Show
 * retired adds the retired ships; a status picked shows only that status, as
 * the filter reads. A squadron picked selects its flagship and members by id,
 * as `squadronsOf` names them; null when no ship can match: the squadrons are
 * not known yet, or none of their ships is.
 */
export function fleetListFilterOf(
  { query, filters }: Pick<FleetView, 'query' | 'filters'>,
  of: { squadronsOf: ReadonlyMap<string, ShipInSquadron> | undefined; pluginShipIds: ReadonlySet<string> },
): FleetListFilter | null {
  const shipIds = filters.squadron.length === 0 ? [] : shipIdsInSquadrons(filters.squadron, of.squadronsOf);
  if (filters.squadron.length > 0 && shipIds.length === 0) {
    return null;
  }
  const needle = query.trim();
  const status = filters.status.length > 0 ? [...filters.status] : filters.isRetiredShown ? (['awaitingCrew', 'crewed', 'retired'] as const) : [];
  return {
    ...(needle === '' ? {} : { query: needle }),
    ...(status.length === 0 ? {} : { status: [...status] }),
    ...(filters.type.length === 0 ? {} : { type: [...filters.type] }),
    ...(filters.crewRequest.length === 0 ? {} : { crewRequest: [...filters.crewRequest] }),
    ...(filters.labelValueIds.length === 0 ? {} : { valueIds: [...filters.labelValueIds] }),
    ...(shipIds.length === 0 ? {} : { shipIds }),
    ...(filters.kind.length === 0 ? {} : { kind: [...filters.kind], pluginShipIds: [...of.pluginShipIds] }),
  };
}

function shipIdsInSquadrons(squadronIds: readonly string[], squadronsOf: ReadonlyMap<string, ShipInSquadron> | undefined): string[] {
  return [...(squadronsOf ?? new Map<string, ShipInSquadron>())].filter(([, ship]) => squadronIds.includes(ship.squadronId)).map(([shipId]) => shipId);
}

/** The overview's sort as `fleet.list` orders by it; none keeps the default order. */
export function fleetListSortOf(sort: FleetSort | null): FleetListSort | undefined {
  return sort === null ? undefined : { column: SORT_COLUMNS_OF[sort.column], direction: sort.direction };
}
