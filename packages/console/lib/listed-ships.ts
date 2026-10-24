'use client';

import type { ListedShip, ShipId } from '@aeolus-fleet/common';
import { isInReadReach } from '@aeolus-fleet/common/rules';
import { useQueries } from '@tanstack/react-query';

import { EVERY_SHIP_STATUS } from './every-ship-status';
import { LAST_SEEN_REFRESH_MS } from './fleet';
import { useTRPC } from './trpc';

/** How many ids one read asks: enough for a screen, few enough that the request's URL stays short. */
export const SHIP_IDS_PER_READ = 100;

/** The ids, each once, in reads of at most SHIP_IDS_PER_READ, sorted so the same ids ask the same reads. */
export function shipIdBatchesOf(shipIds: readonly ShipId[]): ShipId[][] {
  const sorted = [...new Set(shipIds)].toSorted();
  return Array.from({ length: Math.ceil(sorted.length / SHIP_IDS_PER_READ) }, (_, index) => sorted.slice(index * SHIP_IDS_PER_READ, (index + 1) * SHIP_IDS_PER_READ));
}

/**
 * The ships a screen names, as `fleet.list` lists them, by id: only the ids
 * asked, retired ones too, never the whole fleet (decision 4 of the
 * performance design). Only the ships the session reads whole (decision
 * 0034); undefined until every read answered.
 */
export function useListedShips(shipIds: readonly ShipId[]): ReadonlyMap<string, ListedShip> | undefined {
  const trpc = useTRPC();
  const reads = useQueries({
    queries: shipIdBatchesOf(shipIds).map((batch) =>
      trpc.fleet.list.queryOptions({ shipIds: batch, status: EVERY_SHIP_STATUS, limit: batch.length }, { refetchInterval: LAST_SEEN_REFRESH_MS }),
    ),
  });
  if (reads.some((read) => read.data === undefined)) {
    return undefined;
  }
  return new Map(reads.flatMap((read) => (read.data?.items ?? []).filter(isInReadReach).map((ship) => [ship.id, ship] as const)));
}
