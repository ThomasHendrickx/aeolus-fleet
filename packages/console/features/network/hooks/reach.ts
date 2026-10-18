'use client';

import type { ShipId } from '@aeolus-fleet/common';
import { skipToken, useQuery } from '@tanstack/react-query';

import { useTRPC } from '../../../lib/trpc';
import { sendReachOf } from '../services/reach-graph';

/**
 * The ships the picked ship sends to now, as the fleet explains it to argo
 * (decision 0034), by id. Asked only while a ship is picked.
 */
export function useShipReach(pickedShipId: ShipId | undefined) {
  const trpc = useTRPC();
  return useQuery({ ...trpc.fleet.explainReach.queryOptions(pickedShipId === undefined ? skipToken : { fromShipId: pickedShipId }), select: sendReachOf });
}

/** Network's path with the ship picked on the fleet graph, if any. */
export function networkPathOf(pickedShipId: ShipId | undefined): string {
  return pickedShipId === undefined ? '/network' : `/network?reach=${pickedShipId}`;
}
