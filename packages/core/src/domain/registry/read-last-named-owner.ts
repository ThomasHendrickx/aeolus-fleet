import type { Party } from '@aeolus-fleet/common';

import type { ShipCaller } from '../shared/caller.js';
import type { ShipRepository } from './ports.js';

export type ReadLastNamedOwner = (caller: ShipCaller) => Promise<Party | null>;

/**
 * Use case: the person ship the caller named as owner at its last commission
 * that named one, so the console preselects it when argo commissions again
 * (decision 0045). None before the caller named one, and none when that ship
 * is no longer an active person ship, since only those may own a ship argo
 * commissions from the console. The caller's scope (fleet:commission) is
 * checked before this runs.
 */
export function createReadLastNamedOwner(deps: { ships: Pick<ShipRepository, 'findLastNamedOwner'> }): ReadLastNamedOwner {
  return async (caller) => {
    const owner = await deps.ships.findLastNamedOwner(caller.fleetId, caller.shipId);
    return owner?.kind === 'person' && owner.retiredAt === null ? { id: owner.id, name: owner.name } : null;
  };
}
