import type { ShipId } from '@aeolus-fleet/common';

/** How many ids one read asks: enough for a screen, few enough that the request's URL stays short. */
export const SHIP_IDS_PER_READ = 100;

/** The ids, each once, in reads of at most SHIP_IDS_PER_READ, sorted so the same ids ask the same reads. */
export function shipIdBatchesOf(shipIds: readonly ShipId[]): ShipId[][] {
  const sorted = [...new Set(shipIds)].toSorted();
  return Array.from({ length: Math.ceil(sorted.length / SHIP_IDS_PER_READ) }, (_, index) => sorted.slice(index * SHIP_IDS_PER_READ, (index + 1) * SHIP_IDS_PER_READ));
}
