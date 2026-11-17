/** Installation journey reads page compact projections, never customer message history. */
import type { FleetId } from '@aeolus-fleet/common';

import type { Clock } from '../shared/clock.js';
import { fleetJourneySummary, type FleetJourney } from '../shared/fleet-journey.js';

export interface JourneyPagePosition { createdAt: Date; fleetId: FleetId }
export interface InstallationJourneyReads {
  find(fleetId: FleetId): Promise<FleetJourney | undefined>;
  page(position?: JourneyPagePosition): Promise<{ fleetId: FleetId; createdAt: Date; journey: FleetJourney }[]>;
  changes(after: bigint): Promise<{ fleetId: FleetId; seq: bigint; isDeleted: boolean; journey: FleetJourney | null }[]>;
}

const PAGE_SIZE = 20;

export function createReadInstallationJourneys(deps: { reads: InstallationJourneyReads; clock: Clock }) {
  return {
    page: async (position?: JourneyPagePosition) => {
      const rows = await deps.reads.page(position);
      const shown = rows.slice(0, PAGE_SIZE);
      const last = shown.at(-1);
      return { items: shown.map((row) => ({ fleetId: row.fleetId, journey: fleetJourneySummary(row.journey, deps.clock.now()) })),
        next: rows.length > PAGE_SIZE && last ? { createdAt: last.createdAt, fleetId: last.fleetId } : null };
    },
    changes: async (after: bigint) => {
      const rows = await deps.reads.changes(after);
      const shown = rows.slice(0, PAGE_SIZE);
      return { items: shown.map((row) => ({ fleetId: row.fleetId, isDeleted: row.isDeleted, journey: row.journey ? fleetJourneySummary(row.journey, deps.clock.now()) : null })),
        next: shown.at(-1)?.seq ?? after, hasMore: rows.length > PAGE_SIZE };
    },
  };
}
