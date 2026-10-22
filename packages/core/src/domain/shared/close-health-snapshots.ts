import { STUCK_TREND_HOURS, type FleetId } from '@aeolus-fleet/common';

import type { FleetRepository } from '../registry/public.js';
import type { Clock } from './clock.js';
import type { SequencedEvent } from './events.js';
import { closeHour, hourMarkOf, openingHourOf, type EventsAfter, type HealthSnapshotWriter, type LatestSnapshot } from './health-snapshot.js';
import type { DeliveryRecord } from './stuck.js';
import { ok } from './result.js';
import type { UnitOfWork } from './unit-of-work.js';

const HOUR_MS = 60 * 60 * 1000;
/** How many events a close reads at a time, so it never reads a long stretch at once. */
const EVENT_PAGE = 5_000;

export interface CloseHealthSnapshotsTx {
  healthSnapshots: HealthSnapshotWriter;
}

export type CloseHealthSnapshots = () => Promise<void>;

/** What one unit of work did: wrote an hour with more to close, or is done with the fleet for this pass. */
type Closing = 'more' | 'done';

/** The events after the latest, page by page, up to the first page holding one past `mark` or the last. */
async function eventsUpTo(snapshots: HealthSnapshotWriter, read: { fleetId: FleetId; latest: LatestSnapshot; mark: Date }): Promise<EventsAfter> {
  const events: SequencedEvent[] = [];
  const sent: DeliveryRecord[] = [];
  let seq = read.latest.fold.seq;
  for (;;) {
    const page = await snapshots.eventsAfter(read.fleetId, { seq, limit: EVENT_PAGE });
    events.push(...page.events);
    sent.push(...page.sent);
    const last = page.events.at(-1);
    if (last === undefined || page.events.length < EVENT_PAGE || page.events.some((event) => event.occurredAt > read.mark)) {
      return { events, sent };
    }
    seq = last.seq;
  }
}

/**
 * Use case: the close of the stuck snapshot (docs/design/performance/
 * performance.md, section 5), run by core in the 30 second pass, never through
 * the API. Per fleet, one unit of work per hour, under the fleet's snapshot
 * lock: a fleet another instance is closing is skipped. A fleet with no
 * snapshot, or whose latest hour is 168 hours old, starts its first snapshot
 * at the oldest of the 168 hours, from the deliveries open then; each hour
 * after the latest up to the last hour mark is then closed in turn, oldest
 * first, so no unit of work reads more than an hour of events. A unit of work
 * that fails rolls back whole, and the next pass closes the hour again.
 */
export function createCloseHealthSnapshots(deps: { fleets: Pick<FleetRepository, 'list'>; uow: UnitOfWork<CloseHealthSnapshotsTx>; clock: Clock }): CloseHealthSnapshots {
  const closeOne = (fleetId: FleetId) =>
    deps.uow.run(async (tx) => {
      const snapshots = tx.healthSnapshots;
      if (!(await snapshots.tryLock(fleetId))) {
        return ok<Closing>('done');
      }
      const lastHour = hourMarkOf(deps.clock.now());
      const latest = await snapshots.latest(fleetId);
      if (latest === undefined || latest.hour.getTime() <= lastHour.getTime() - STUCK_TREND_HOURS * HOUR_MS) {
        const hour = new Date(lastHour.getTime() - (STUCK_TREND_HOURS - 1) * HOUR_MS);
        const [fold, crews] = await Promise.all([snapshots.baseAt(fleetId, hour), snapshots.crews(fleetId, hour)]);
        await snapshots.write(fleetId, { hours: [openingHourOf(fold, { hour, crews })], fold });
        return ok<Closing>(hour < lastHour ? 'more' : 'done');
      }
      if (latest.hour >= lastHour) {
        return ok<Closing>('done');
      }
      const mark = new Date(latest.hour.getTime() + HOUR_MS);
      const [after, crews] = await Promise.all([eventsUpTo(snapshots, { fleetId, latest, mark }), snapshots.crews(fleetId, latest.hour)]);
      const closed = closeHour(latest, { ...after, crews });
      await snapshots.write(fleetId, { hours: [closed.hour], fold: closed.fold });
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
