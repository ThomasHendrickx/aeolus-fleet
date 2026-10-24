import type { FleetListFilter, ShipKind } from '@aeolus-fleet/common';

/** How many ships the view selects, of every ship in the fleet, and how many of those are retired (`fleet.shipCounts`). */
export interface FleetCounts {
  shown: number;
  total: number;
  retired: number;
}

/** One kind of ship as `fleet.shipCounts` counts it: what the overview's counts read of it. */
export interface KindCount {
  kind: ShipKind;
  /** Not retired. */
  active: number;
  retired: number;
}

function sumOf(counts: readonly KindCount[], count: (kind: KindCount) => number): number {
  return counts.reduce((total, each) => total + count(each), 0);
}

/**
 * The overview's counts: how many ships the view selects (the view's own
 * count, retired ones only when its filter asks for them, as `fleet.list`
 * answers), of every ship in the fleet, and how many of those are retired.
 */
export function fleetCountsOf(counts: { view: readonly KindCount[]; fleet: readonly KindCount[] }, filter: FleetListFilter): FleetCounts {
  const isRetiredAsked = filter.status?.includes('retired') ?? false;
  return {
    shown: sumOf(counts.view, (each) => each.active + (isRetiredAsked ? each.retired : 0)),
    total: sumOf(counts.fleet, (each) => each.active + each.retired),
    retired: sumOf(counts.fleet, (each) => each.retired),
  };
}

/** Whether argo is the fleet's only active ship: no active ship of any other kind. */
export function isOnlyArgoIn(fleet: readonly KindCount[]): boolean {
  return sumOf(fleet, (each) => (each.kind === 'operator' ? 0 : each.active)) === 0;
}
