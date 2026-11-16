/** Independent retention for bounded daily journey facts, including fleets with no new activity. */
import type { FleetId } from '@aeolus-fleet/common';

import type { Clock } from './clock.js';
import { journeyActivitySince, type FleetJourney } from './fleet-journey.js';
import { ok } from './result.js';
import type { UnitOfWork } from './unit-of-work.js';

export interface JourneyActivityExpiry {
  expired(now: Date, limit: number): Promise<{ fleetId: FleetId; journey: FleetJourney }[]>;
  save(fleetId: FleetId, journey: FleetJourney): Promise<void>;
}

const EXPIRY_BATCH_SIZE = 20;

export function createExpireJourneyActivity(deps: { clock: Clock; uow: UnitOfWork<{ journeyActivity: JourneyActivityExpiry }> }) {
  return async (): Promise<void> => {
    const now = deps.clock.now();
    const cutoff = journeyActivitySince(now);
    await deps.uow.run(async (tx) => {
      const rows = await tx.journeyActivity.expired(now, EXPIRY_BATCH_SIZE);
      for (const row of rows) {
        await tx.journeyActivity.save(row.fleetId, { ...row.journey, activityDates: row.journey.activityDates.filter((date) => date >= cutoff) });
      }
      return ok(undefined);
    });
  };
}
