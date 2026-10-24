import type { ShipId, ShipKind } from '@aeolus-fleet/common';
import { useQuery } from '@tanstack/react-query';

import { useTRPC } from './trpc';

/** One kind of ship as `fleet.shipCounts` counts it, within the session's read reach. */
export interface ShipKindCount {
  kind: ShipKind;
  /** Not retired. */
  active: number;
  crewed: number;
  awaitingCrew: number;
  retired: number;
  /** How many need crew, with the trierarch plugin connected and without it (lib/needs-crew.ts). */
  needsCrew: { withTrierarchs: number; withoutTrierarchs: number };
  /** The active ship that has awaited crew longest; none while every active ship is crewed. */
  longestWait: { id: ShipId; name: string; awaitingCrewSince: string } | null;
}

/** How many ships need crew, of every kind, as the trierarch plugin being connected decides: the navigation's Needs crew count. */
export function needsCrewCountOf(counts: readonly ShipKindCount[], plugin: { hasTrierarchs: boolean }): number {
  return counts.reduce((total, count) => total + (plugin.hasTrierarchs ? count.needsCrew.withTrierarchs : count.needsCrew.withoutTrierarchs), 0);
}

/**
 * The fleet's ships counted per kind (`fleet.shipCounts`), within the
 * session's read reach: the overview's cards and subtitle and the Needs crew
 * count read these, never the whole fleet (performance design, decision 2).
 * A ship's live event reloads them (lib/live-fleet.ts).
 */
export function useShipCounts() {
  const trpc = useTRPC();
  return useQuery(trpc.fleet.shipCounts.queryOptions());
}
