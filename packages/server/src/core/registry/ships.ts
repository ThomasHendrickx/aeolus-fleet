import type { FleetId } from '@aeolus-fleet/common';

import { DomainError } from '../shared/errors.js';
import type { ShipRepository } from './ports.js';
import type { Ship } from './ship.js';

export interface ShipTx {
  ships: ShipRepository;
}

/** The fleet's operator ship, `argo`. Fails when the fleet does not exist. */
export async function findOperatorShip(tx: ShipTx, fleetId: FleetId): Promise<Ship> {
  const ship = await tx.ships.findOperatorShip(fleetId);
  if (!ship) {
    throw new DomainError('FLEET_NOT_FOUND', `Fleet ${fleetId} does not exist`);
  }
  return ship;
}
