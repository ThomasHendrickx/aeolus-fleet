/** Folds a committed source batch and its watermark atomically with the source transaction. */
import type { FleetId } from '@aeolus-fleet/common';

import { newFleetJourney, projectFleetJourney, type FleetJourney, type JourneyFact } from './fleet-journey.js';

export interface JourneyRecords {
  read(fleetId: FleetId): Promise<FleetJourney | undefined>;
  save(fleetId: FleetId, journey: FleetJourney): Promise<void>;
}

export function createRecordFleetJourney(deps: { records: JourneyRecords }) {
  return async (input: { fleetId: FleetId; createdAt: string; coverageFrom: string; computedAt: string; processedThrough: number; facts: readonly JourneyFact[] }): Promise<void> => {
    const state = await deps.records.read(input.fleetId) ?? newFleetJourney(input);
    await deps.records.save(input.fleetId, projectFleetJourney(state, input));
  };
}
