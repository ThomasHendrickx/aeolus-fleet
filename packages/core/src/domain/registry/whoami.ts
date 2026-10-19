import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { ShipCaller } from '../shared/caller.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { ShipRepository } from './ports.js';

/** The caller's ship, as `whoami` tells it. */
export interface ShipIdentity {
  shipId: ShipId;
  fleetId: FleetId;
  name: string;
  type: string;
  /** Its owner's id and name, both null for argo and the viewer (decision 0045). */
  ownerShipId: ShipId | null;
  ownerName: string | null;
}

export type Whoami = (caller: ShipCaller) => Promise<Result<ShipIdentity, DomainError<'SHIP_NOT_FOUND'>>>;

/**
 * Use case: tells the caller which ship it crews: id, fleet, name, type and
 * owner.
 * Any caller may ask, whatever its scopes: it learns only about itself.
 */
export function createWhoami(deps: { ships: Pick<ShipRepository, 'find'> }): Whoami {
  return async (caller) => {
    const ship = await deps.ships.find(caller.fleetId, caller.shipId);
    if (!ship) {
      return refuse('SHIP_NOT_FOUND', `Ship ${caller.shipId} does not exist`);
    }
    const owner = ship.owner === null ? undefined : await deps.ships.find(caller.fleetId, ship.owner);
    return ok({ shipId: ship.id, fleetId: ship.fleetId, name: ship.name, type: ship.type, ownerShipId: owner?.id ?? null, ownerName: owner?.name ?? null });
  };
}
