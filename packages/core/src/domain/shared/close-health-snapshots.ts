import { ACKNOWLEDGED_HOURS, STUCK_TREND_HOURS, type FleetId } from '@aeolus-fleet/common';

import type { FleetRepository } from '../registry/public.js';
import type { Clock } from './clock.js';
import { closeHour, firstSnapshot, hourMarkOf, type HealthSnapshotWriter } from './health-snapshot.js';
import { healthSince, type HealthRecords } from './health.js';
import { ok } from './result.js';
import type { UnitOfWork } from './unit-of-work.js';

const HOUR_MS = 60 * 60 * 1000;

export interface CloseHealthSnapshotsTx {
  healthSnapshots: HealthSnapshotWriter;
  health: HealthRecords;
}

export type CloseHealthSnapshots = () => Promise<void>;

/** What one unit of work did: closed an hour with more to close, or is done with the fleet for this pass. */
type Closing = 'more' | 'done';

/**
 * Use case: the close of the stuck snapshot (docs/design/performance/
 * performance.md, section 5), run by core in the 30 second pass, never through
 * the API. Per fleet, one unit of work per hour, under the fleet's snapshot
 * lock: a fleet another instance is closing is skipped. A fleet with no
 * snapshot, or whose latest hour is 168 hours old, gets its first snapshot
 * replayed from its records; else each hour after the latest up to the last
 * hour mark is closed in turn, oldest first. A unit of work that fails rolls
 * back whole, and the next pass closes the hour again.
 */
export function createCloseHealthSnapshots(deps: { fleets: Pick<FleetRepository, 'list'>; uow: UnitOfWork<CloseHealthSnapshotsTx>; clock: Clock }): CloseHealthSnapshots {
  const closeOne = (fleetId: FleetId) =>
    deps.uow.run(async (tx) => {
      if (!(await tx.healthSnapshots.tryLock(fleetId))) {
        return ok<Closing>('done');
      }
      const lastHour = hourMarkOf(deps.clock.now());
      const latest = await tx.healthSnapshots.latest(fleetId);
      if (latest === undefined || latest.hour.getTime() <= lastHour.getTime() - STUCK_TREND_HOURS * HOUR_MS) {
        const [records, acknowledged, seq] = await Promise.all([
          tx.health.read(fleetId, healthSince(lastHour)),
          tx.health.acknowledged(fleetId, new Date(lastHour.getTime() - ACKNOWLEDGED_HOURS * HOUR_MS)),
          tx.healthSnapshots.seqAt(fleetId, lastHour),
        ]);
        await tx.healthSnapshots.write(fleetId, firstSnapshot(records, { lastHour, seq, acknowledged }));
        return ok<Closing>('done');
      }
      if (latest.hour >= lastHour) {
        return ok<Closing>('done');
      }
      const [after, crews] = await Promise.all([tx.healthSnapshots.eventsAfter(fleetId, latest.fold.seq), tx.healthSnapshots.crews(fleetId, latest.hour)]);
      const closed = closeHour(latest, { ...after, crews });
      await tx.healthSnapshots.write(fleetId, { hours: [closed.hour], fold: closed.fold });
      return ok<Closing>(closed.hour.hour < lastHour ? 'more' : 'done');
    });

  return async () => {
    for (const fleet of await deps.fleets.list()) {
      let closing: Closing = 'more';
      while (closing === 'more') {
        const result = await closeOne(fleet.id);
        closing = result.isOk ? result.value : 'done';
      }
    }
  };
}
