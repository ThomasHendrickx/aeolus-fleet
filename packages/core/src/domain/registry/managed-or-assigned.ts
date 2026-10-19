import type { IdGenerator } from '@aeolus-fleet/common';

import { hasScope, isShipCaller, type Caller } from '../shared/caller.js';
import { refuse } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { checkManage, type CheckManageTx, type NotReachable } from './check-reach.js';
import type { NotTheCallers } from './crew-request.js';
import type { CrewRequestRepository } from './ports.js';
import type { Ship } from './ship.js';

export type ManagedOrAssignedTx = CheckManageTx & { crewRequests: Pick<CrewRequestRepository, 'find'> };

/**
 * Whether the caller may act on the ship for a call it takes with
 * fleet:manage or crew:run (decision 0029): a ship whose crew request is
 * assigned to the caller's ship, by crew:run; else, with fleet:manage, a ship
 * in its manage reach (decision 0034), a refusal recorded as the reach check
 * records it.
 */
export async function checkManagedOrAssigned(
  deps: { tx: ManagedOrAssignedTx; ids: IdGenerator },
  call: { caller: Caller; ship: Ship; at: Date },
): Promise<Result<undefined, NotTheCallers | NotReachable>> {
  const { tx, ids } = deps;
  const { caller, ship, at } = call;
  if (isShipCaller(caller) && (await tx.crewRequests.find(ship.fleetId, ship.id))?.assignedTo === caller.shipId) {
    return ok(undefined);
  }
  if (!hasScope(caller, 'fleet:manage')) {
    return refuse('CREW_REQUEST_NOT_ASSIGNED_TO_CALLER', `${ship.name}'s crew request is not assigned to your ship`);
  }
  return checkManage({ tx, ids }, { manager: caller, shipId: ship.id, at });
}
