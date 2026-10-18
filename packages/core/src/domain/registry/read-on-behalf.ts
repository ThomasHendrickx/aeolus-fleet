import type { ShipId } from '@aeolus-fleet/common';

import { hasScope, type Caller } from '../shared/caller.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { ShipRepository } from './ports.js';

export type ReadOnBehalf = (
  caller: Caller,
  input: { shipId: ShipId },
) => Promise<Result<Caller, DomainError<'SCOPE_NOT_HELD' | 'SHIP_NOT_FOUND' | 'SHIP_NOT_READ_ON_BEHALF'>>>;

/**
 * Use case: the reader a plugin ship reads as on behalf of a named ship
 * (decision 0034): the named ship with fleet:read only, so every fleet:read
 * read filters by that ship's read reach whatever its own scopes, with the
 * plugin kept as the one that asked. The plugin needs fleet:read itself. argo
 * and the viewer are never named: their read is the whole fleet, which a
 * plugin would gain by naming them.
 */
export function createReadOnBehalf(deps: { ships: Pick<ShipRepository, 'find'> }): ReadOnBehalf {
  return async (caller, { shipId }) => {
    if (!hasScope(caller, 'fleet:read')) {
      return refuse('SCOPE_NOT_HELD', 'Reading on behalf of a ship needs the fleet:read scope');
    }
    const ship = await deps.ships.find(caller.fleetId, shipId);
    if (ship?.retiredAt !== null) {
      return refuse('SHIP_NOT_FOUND', `No ship ${shipId} in this fleet`);
    }
    if (ship.kind === 'operator' || ship.kind === 'viewer') {
      return refuse('SHIP_NOT_READ_ON_BEHALF', `A plugin reads on behalf of no ${ship.kind === 'operator' ? 'argo' : 'viewer'}: its read is the whole fleet`);
    }
    return ok({ fleetId: caller.fleetId, shipId: ship.id, kind: ship.kind, scopes: ['fleet:read'], askedBy: caller.shipId });
  };
}
