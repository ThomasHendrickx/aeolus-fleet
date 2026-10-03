import type { ShipId } from '@aeolus-fleet/common';

import type { Result } from '../shared/result.js';

/** Why the fleet refused a ship call: its code (CONFLICT, UNAUTHORIZED, LEASE_ENDED, ...) and its message. */
export interface FleetRefusal {
  code: string;
  message: string;
}

/**
 * Outbound port: the fleet's public ship calls, as squadrons makes them for
 * its management ship. squadrons is a ship like any other (decision 0017).
 */
export interface FleetDoor {
  register(claim: { shipId: ShipId; secret: string }): Promise<Result<{ crewToken: string }, FleetRefusal>>;
  whoami(crewToken: string): Promise<Result<{ shipId: string; name: string; type: string }, FleetRefusal>>;
}

/** The crew token squadrons holds for its management ship, and when it got it. */
export interface ManagementCrew {
  shipId: ShipId;
  crewToken: string;
  crewedAt: Date;
}

/** Outbound port: where squadrons keeps its management ship's crew token across restarts. */
export interface ManagementCrewStore {
  find(): Promise<ManagementCrew | undefined>;
  save(crew: ManagementCrew): Promise<void>;
}
