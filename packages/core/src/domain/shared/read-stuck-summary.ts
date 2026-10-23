import { STUCK_CAUSES, type ShipId, type StuckCause } from '@aeolus-fleet/common';

import { readsMessage, readsShip, type ReadReachOf } from '../registry/public.js';
import type { Caller } from './caller.js';
import type { Clock } from './clock.js';
import { readStuckPlacesOf } from './health-read.js';
import type { HealthSnapshots } from './health-snapshot.js';
import type { HealthRecords, StuckPlaceHealth } from './health.js';

/** How many deliveries are stuck now and in how many places, in all, per cause and per machine. */
export interface StuckSummary {
  count: number;
  places: number;
  /** Since when the oldest stuck delivery waits; none when nothing is stuck. */
  oldestSince: Date | null;
  /** Each cause with stuck deliveries, in the causes' order. */
  byCause: { cause: StuckCause; count: number; places: number }[];
  /** Each machine behind a ship deliveries are stuck at, by name. */
  byMachine: { machine: { id: ShipId; name: string }; count: number }[];
}

export type ReadStuckSummary = (caller: Caller) => Promise<StuckSummary>;

/** The summary of the stuck places. */
export function stuckSummaryOf(places: readonly StuckPlaceHealth[]): StuckSummary {
  const [oldest] = places.map((place) => place.oldestSince).toSorted((first, second) => first.getTime() - second.getTime());
  const byMachine = new Map<ShipId, StuckSummary['byMachine'][number]>();
  for (const { place, count } of places) {
    const machine = place.kind === 'ship' ? place.machine : null;
    if (machine !== null) {
      const counted = byMachine.get(machine.id);
      byMachine.set(machine.id, { machine: { id: machine.id, name: machine.name }, count: (counted?.count ?? 0) + count });
    }
  }
  return {
    count: places.reduce((sum, place) => sum + place.count, 0),
    places: places.length,
    oldestSince: oldest ?? null,
    byCause: STUCK_CAUSES.flatMap((cause) => {
      const ofCause = places.filter((place) => place.cause === cause);
      return ofCause.length === 0 ? [] : [{ cause, count: ofCause.reduce((sum, place) => sum + place.count, 0), places: ofCause.length }];
    }),
    byMachine: [...byMachine.values()].toSorted((first, second) => first.machine.name.localeCompare(second.machine.name) || first.machine.id.localeCompare(second.machine.id)),
  };
}

/**
 * Use case: how many deliveries of the caller's fleet are stuck now and in how
 * many places, in all, per cause and per machine, for the Health page's
 * verdict, cause cards, machines panel and cause page; counting only the
 * deliveries whose message the caller reads, and a machine only behind a ship
 * the caller reads (decision 0034). The caller's scope (fleet:read) is checked
 * before this runs.
 */
export function createReadStuckSummary(deps: { health: HealthRecords; snapshots: HealthSnapshots; clock: Clock; readReach: ReadReachOf }): ReadStuckSummary {
  return async (caller) => {
    const reach = await deps.readReach(caller);
    const places = await readStuckPlacesOf({ records: deps.health, snapshots: deps.snapshots }, {
      fleetId: caller.fleetId,
      now: deps.clock.now(),
      reads: (message) => readsMessage(reach, message),
      readsShip: (shipId) => readsShip(reach, shipId),
    });
    return stuckSummaryOf(places);
  };
}
