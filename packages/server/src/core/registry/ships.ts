import type { FleetId, ShipId } from '@aeolus-fleet/common';

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

/** The fleet's viewer ship (decision 0022). Refuses when the fleet has none. */
export async function findViewerShip(tx: ShipTx, fleetId: FleetId): Promise<Result<Ship, DomainError<'FLEET_HAS_NO_VIEWER'>>> {
  const ship = await tx.ships.findViewerShip(fleetId);
  return ship ? ok(ship) : refuse('FLEET_HAS_NO_VIEWER', `Fleet ${fleetId} has no viewer ship: create it with one to hand out viewer tickets`);
}

/** The ports finding a ship reads, inside the caller's unit of work. */
export interface FindShipTx {
  ships: Pick<ShipRepository, 'find'>;
}

/**
 * A ship of the fleet as it is now, retired or not: its current name and
 * type. Messaging's question when it hands a crew a delivery, so the crew can
 * answer the sender by name. Read without a lock.
 */
export async function findShip(
  tx: FindShipTx,
  input: { fleetId: FleetId; shipId: ShipId },
): Promise<Result<Ship, DomainError<'SHIP_NOT_FOUND'>>> {
  const ship = await tx.ships.find(input.fleetId, input.shipId);
  return ship ? ok(ship) : refuse('SHIP_NOT_FOUND', `Ship ${input.shipId} does not exist`);
}
