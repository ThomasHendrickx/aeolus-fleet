import type { FleetId, ShipId, ShipStatus } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { LeaseRepository, ShipRepository } from './ports.js';
import { shipStatus, type Ship } from './ship.js';

/**
 * A message's sender as Registry holds it now, retired or not: Messaging's
 * question when it hands a crew a delivery, so the crew can answer the sender
 * by name and tell from its status whether it still could.
 */
export interface Sender {
  ship: Ship;
  status: ShipStatus;
}

/** The ports reading a sender takes, inside the caller's unit of work. */
export interface FindSenderTx {
  ships: Pick<ShipRepository, 'find'>;
  leases: Pick<LeaseRepository, 'findCrewed'>;
}

/** The ports reading a page's senders takes, inside the caller's unit of work. */
export interface FindSendersTx {
  ships: Pick<ShipRepository, 'findMany'>;
  leases: Pick<LeaseRepository, 'findCrewed'>;
}

/**
 * One sender, by its id: its current name and type, and its status derived as
 * the fleet read derives it. Read without a lock: a retire or a release that
 * commits meanwhile shows at the next read.
 */
export async function findSender(
  tx: FindSenderTx,
  input: { fleetId: FleetId; shipId: ShipId },
): Promise<Result<Sender, DomainError<'SHIP_NOT_FOUND'>>> {
  const ship = await tx.ships.find(input.fleetId, input.shipId);
  if (!ship) {
    return refuse('SHIP_NOT_FOUND', `Ship ${input.shipId} does not exist`);
  }
  const crewed = await tx.leases.findCrewed(input.fleetId, [ship.id]);
  return ok({ ship, status: shipStatus(ship, { isCrewed: crewed.includes(ship.id) }) });
}

/**
 * The senders of a page of deliveries, by id, in two batched reads however
 * many deliveries each one sent: the ships, then which of them a session
 * crews. Read without a lock, as {@link findSender} reads one.
 */
export async function findSenders(tx: FindSendersTx, input: { fleetId: FleetId; shipIds: readonly ShipId[] }): Promise<Map<ShipId, Sender>> {
  const shipIds = [...new Set(input.shipIds)];
  const ships = await tx.ships.findMany(input.fleetId, shipIds);
  const crewed = new Set(await tx.leases.findCrewed(input.fleetId, ships.map((ship) => ship.id)));
  return new Map(ships.map((ship) => [ship.id, { ship, status: shipStatus(ship, { isCrewed: crewed.has(ship.id) }) }]));
}
