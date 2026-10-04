import type { FleetId, ShipId } from '@aeolus-fleet/common';

/**
 * A create or delete the installation carried out, under the caller's own
 * request id, so a replay answers what the first call answered (decision
 * 0020). It belongs to the installation, not to a fleet: a deleted fleet
 * keeps no rows, but its delete must still answer the same.
 */
export type InstallationRequest = {
  requestId: string;
  at: Date;
  fleetId: FleetId;
  /** The fleet's name and operator email when the request was carried out. */
  name: string;
  operatorEmail: string;
} & ({ kind: 'createFleet'; operatorShipId: ShipId } | { kind: 'deleteFleet' });
