import type { FleetId } from '@aeolus-fleet/common';

import type { Squadron } from './squadron.js';

/** Outbound port: squadrons, in squadrons' own database, always within one fleet. */
export interface SquadronRepository {
  exists(fleetId: FleetId, id: string): Promise<boolean>;
  create(squadron: Squadron): Promise<void>;
  /** The fleet's squadrons, oldest first. */
  list(fleetId: FleetId): Promise<Squadron[]>;
}

/** Outbound port: random lowercase alphanumerics, for squadron ids and member names. */
export interface RandomNames {
  suffix(length: number): string;
}
