'use client';

import type { ShipId } from '@aeolus-fleet/common';
import { skipToken, useQuery } from '@tanstack/react-query';

import { useTRPC } from '../../../lib/trpc';

/**
 * What the picked ship reaches now, as the fleet explains it to argo (design
 * point 11 on #260): the ships, never why. Asked only while a ship is picked.
 */
export function useShipReach(pickedShipId: ShipId | undefined) {
  const trpc = useTRPC();
  return useQuery(trpc.fleet.explainReach.queryOptions(pickedShipId === undefined ? skipToken : { fromShipId: pickedShipId }));
}

/** Network's path with the ship picked on the fleet graph, if any. */
export function networkPathOf(pickedShipId: ShipId | undefined): string {
  return pickedShipId === undefined ? '/network' : `/network?reach=${pickedShipId}`;
}
