import type { FleetId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { ShipRepository } from './ports.js';
import type { Ship } from './ship.js';

export interface ShipTx {
  ships: ShipRepository;
}

/** The fleet's operator ship, `argo`. Refuses when the fleet does not exist. */
export async function findOperatorShip(
  tx: ShipTx,
  fleetId: FleetId,
): Promise<Result<Ship, DomainError<'FLEET_NOT_FOUND'>>> {
  const ship = await tx.ships.findOperatorShip(fleetId);
  return ship ? ok(ship) : refuse('FLEET_NOT_FOUND', `Fleet ${fleetId} does not exist`);
}
