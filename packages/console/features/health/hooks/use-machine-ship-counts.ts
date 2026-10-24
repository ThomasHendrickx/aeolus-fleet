'use client';

import type { ShipId } from '@aeolus-fleet/common';
import { useQueries } from '@tanstack/react-query';

import { useTRPC } from '../../../lib/trpc';

/**
 * How many active ships each machine crews: the ships whose crew request is
 * assigned to its trierarch, counted on the server (`fleet.shipCounts`), one
 * read per machine, never the whole fleet (decision 4 of the performance
 * design). A ship's live event reloads them (lib/live-fleet.ts). A machine
 * not counted yet is missing.
 */
export function useMachineShipCounts(machineShipIds: readonly ShipId[]): ReadonlyMap<ShipId, number> {
  const trpc = useTRPC();
  const reads = useQueries({ queries: machineShipIds.map((shipId) => trpc.fleet.shipCounts.queryOptions({ filter: { assignedTo: [shipId] } })) });
  const counts = new Map<ShipId, number>();
  machineShipIds.forEach((shipId, index) => {
    const kinds = reads[index]?.data;
    if (kinds !== undefined) {
      counts.set(shipId, kinds.reduce((total, kind) => total + kind.active, 0));
    }
  });
  return counts;
}
