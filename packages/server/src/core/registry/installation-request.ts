import type { FleetId, ShipId } from '@aeolus-fleet/common';

/**
 * A create or delete the installation carried out, under the caller's own
 * request id, so a replay answers what the first call answered (decision
 * 0020). It belongs to the installation, not to a fleet. It keeps the request
 * as a hash only: a delete record names nothing of the fleet it deleted, and a
 * create record, which holds the fleet and argo it answers with, goes with
 * that fleet.
 */
export type InstallationRequest = {
  requestId: string;
  at: Date;
  /** The hash of the request it carried out: a replay under its id must hash the same. */
  requestHash: string;
} & ({ kind: 'createFleet'; fleetId: FleetId; operatorShipId: ShipId } | { kind: 'deleteFleet' });

/** A request as hashed for its record: its kind and what it names, in a fixed order. */
export function installationRequestText(request: readonly string[]): string {
  return JSON.stringify(request);
}
