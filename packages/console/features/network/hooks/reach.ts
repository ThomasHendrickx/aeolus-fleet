'use client';

import type { ShipId } from '@aeolus-fleet/common';
import { skipToken, useQuery } from '@tanstack/react-query';

import { useTRPC } from '../../../lib/trpc';
import { sendReachOf, type ReachAgainst } from '../services/reach-graph';

/** How many ships sail in the fleet: every active ship but the viewer (`fleet.shipCounts`); undefined while read. */
export function useSailingShipCount(): number | undefined {
  const trpc = useTRPC();
  const counts = useQuery(trpc.fleet.shipCounts.queryOptions());
  return counts.data?.filter((kind) => kind.kind !== 'viewer').reduce((total, kind) => total + kind.active, 0);
}

/**
 * The ships the picked ship sends to, as the fleet explains it (decision
 * 0034), against the applied rules or the draft (decision 0035), by id.
 * Asked only while a ship is picked.
 */
export function useShipReach(pickedShipId: ShipId | undefined, against: ReachAgainst) {
  const trpc = useTRPC();
  return useQuery({ ...trpc.fleet.explainReach.queryOptions(pickedShipId === undefined ? skipToken : { fromShipId: pickedShipId, against }), select: sendReachOf });
}

/** Network's path with the ship picked on the fleet graph, if any, and the draft when the graph shows the reach against it. */
export function networkPathOf(pickedShipId: ShipId | undefined, against: ReachAgainst = 'applied'): string {
  const query = new URLSearchParams([...(pickedShipId === undefined ? [] : [['reach', pickedShipId]]), ...(against === 'draft' ? [['against', 'draft']] : [])]);
  const search = query.toString();
  return search === '' ? '/network' : `/network?${search}`;
}
