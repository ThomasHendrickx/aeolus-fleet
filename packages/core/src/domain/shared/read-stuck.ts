import { PAGE_SIZE_DEFAULT, type DeliveryId, type StuckCause } from '@aeolus-fleet/common';

import type { ReadReachOf } from '../registry/public.js';
import type { Caller } from './caller.js';
import type { Clock } from './clock.js';
import { readStuckPlacesOf } from './health-read.js';
import type { HealthSnapshots } from './health-snapshot.js';
import type { StuckPlaceHealth, HealthRecords } from './health.js';

/** Where a page of stuck places ends: the oldest delivery of its last place, as places are ordered. */
export interface StuckCursor {
  oldestSince: Date;
  deliveryId: DeliveryId;
}

/** A page of stuck places, and the cursor the next page starts after; null on the last page. */
export interface StuckPage {
  items: StuckPlaceHealth[];
  nextCursor: StuckCursor | null;
}

export type ReadStuck = (caller: Caller, input: { cause?: StuckCause; cursor?: StuckCursor; limit?: number }) => Promise<StuckPage>;

function cursorOf(place: StuckPlaceHealth): StuckCursor | undefined {
  const [oldest] = place.deliveries;
  return oldest && { oldestSince: oldest.since, deliveryId: oldest.deliveryId };
}

/** Whether the place comes after the cursor: places go by their oldest delivery's since, then its id. */
function isAfter(place: StuckPlaceHealth, cursor: StuckCursor): boolean {
  const oldest = cursorOf(place);
  if (oldest === undefined) {
    return false;
  }
  const bySince = oldest.oldestSince.getTime() - cursor.oldestSince.getTime();
  return bySince > 0 || (bySince === 0 && oldest.deliveryId.localeCompare(cursor.deliveryId) > 0);
}

/** The page of the places after the cursor, of the cause when asked. */
export function stuckPageOf(places: readonly StuckPlaceHealth[], page: { cause?: StuckCause; cursor?: StuckCursor; limit?: number }): StuckPage {
  const { cause, cursor, limit = PAGE_SIZE_DEFAULT } = page;
  const after = places.filter((place) => (cause === undefined || place.cause === cause) && (cursor === undefined || isAfter(place, cursor)));
  const items = after.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: after.length > limit && last !== undefined ? (cursorOf(last) ?? null) : null };
}

/**
 * Use case: a page of the deliveries of the caller's fleet stuck now by cause
 * and place, the oldest waiting first, after the cursor and of one cause when
 * asked, each ship by name with the machine behind it only
 * when the caller reads the ship, for the Health page's causes and machines;
 * counting only the deliveries whose message the caller reads (decision
 * 0034). The caller's scope (fleet:read) is checked before this runs.
 */
export function createReadStuck(deps: { health: HealthRecords; snapshots: HealthSnapshots; clock: Clock; readReach: ReadReachOf }): ReadStuck {
  return async (caller, page) => {
    const reach = await deps.readReach(caller);
    const places = await readStuckPlacesOf({ records: deps.health, snapshots: deps.snapshots }, {
      fleetId: caller.fleetId,
      now: deps.clock.now(),
      reach,
    });
    return stuckPageOf(places, page);
  };
}
