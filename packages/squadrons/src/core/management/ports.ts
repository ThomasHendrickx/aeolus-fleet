import type { FleetId, ShipId } from '@aeolus-fleet/common';

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
  whoami(crewToken: string): Promise<Result<{ shipId: ShipId; fleetId: FleetId; name: string; type: string }, FleetRefusal>>;
  /** Commissions an agent ship as the crew token's ship (fleet:manage); answers its id and its crew line, which holds its secret. */
  commission(crewToken: string, ship: { name: string; type: string }): Promise<Result<{ shipId: ShipId; crewLine: string }, FleetRefusal>>;
  /** Retires a ship as the crew token's ship (fleet:manage). */
  retire(crewToken: string, ship: { shipId: ShipId }): Promise<Result<undefined, FleetRefusal>>;
}

/** The crew token squadrons holds for its management ship, and when it got it. */
export interface ManagementCrew {
  /** The fleet the management ship belongs to: the fleet squadrons serves. */
  fleetId: FleetId;
  shipId: ShipId;
  crewToken: string;
  crewedAt: Date;
}

/** Outbound port: where squadrons keeps its management ship's crew token across restarts. */
export interface ManagementCrewStore {
  find(): Promise<ManagementCrew | undefined>;
  save(crew: ManagementCrew): Promise<void>;
}
