/** Ship reads ordered with ownership, so retiring an owner cannot deadlock a grant. */
import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { ShipRepository } from './ports.js';
import type { Ship } from './ship.js';

interface HeldShipTx {
  ships: Pick<ShipRepository, 'find' | 'findForShare'>;
}

/**
 * The ship, read again once its owner is held FOR SHARE, so the owner the new
 * ship gets is never a retired one. A retire locks the owner first: one that
 * committed before has moved the ship to argo, so the owner read changed and
 * its new owner is held instead; one after waits for this commission and finds
 * the new ship among those it hands to argo.
 */
export async function findWithOwnerHeld(tx: HeldShipTx, ref: { fleetId: FleetId; shipId: ShipId }): Promise<Ship | undefined> {
  let ship = await tx.ships.find(ref.fleetId, ref.shipId);
  while (ship?.owner) {
    const owner = ship.owner;
    await tx.ships.findForShare(ref.fleetId, owner);
    ship = await tx.ships.find(ref.fleetId, ref.shipId);
    if (ship?.owner === owner) {
      return ship;
    }
  }
  return ship;
}

/**
 * The ship, held FOR SHARE after its owner, the order a retire of
 * the owner takes, and read again once held. A revoke of one of its scopes
 * waits for the transaction, so approval and commission check rights that
 * stay held through their commit (decision 0046).
 */
export async function findShipWithOwnerHeld(tx: HeldShipTx, ref: { fleetId: FleetId; shipId: ShipId }): Promise<Ship | undefined> {
  for (;;) {
    const read = await findWithOwnerHeld(tx, ref);
    if (!read) {
      return undefined;
    }
    await tx.ships.findForShare(ref.fleetId, ref.shipId);
    const held = await tx.ships.find(ref.fleetId, ref.shipId);
    if (held?.owner === read.owner) {
      return held;
    }
  }
}

