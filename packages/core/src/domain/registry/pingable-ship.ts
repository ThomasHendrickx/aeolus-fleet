import type { FleetId, ShipId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { LeaseRepository, ShipRepository } from './ports.js';
import { checkCanBePinged, type PingRefusal, type Ship } from './ship.js';

/** The ports finding a ship to ping reads, inside the caller's unit of work. */
export interface PingableShipTx {
  ships: Pick<ShipRepository, 'findForUpdate'>;
  leases: Pick<LeaseRepository, 'findOpenForShare'>;
}

export type UnpingableShip = DomainError<'SHIP_NOT_FOUND'> | PingRefusal;

/**
 * The ship a ping goes to, if it can be pinged: Messaging's question before
 * it pings. The ship stays locked until the unit of work ends, so two pings
 * of one ship take turns and the second finds the first one's ping: pings
 * never stack. Its open lease is held against a release meanwhile. Lock
 * order as everywhere: the ship, then its lease.
 */
export async function findPingableShip(
  tx: PingableShipTx,
  input: { fleetId: FleetId; shipId: ShipId },
): Promise<Result<Ship, UnpingableShip>> {
  const { fleetId, shipId } = input;
  const ship = await tx.ships.findForUpdate(fleetId, shipId);
  if (!ship) {
    return refuse('SHIP_NOT_FOUND', `Ship ${shipId} does not exist`);
  }
  const lease = await tx.leases.findOpenForShare(fleetId, shipId);
  const pingable = checkCanBePinged(ship, { isCrewed: lease !== undefined });
  return pingable.isOk ? ok(ship) : pingable;
}
