/** Live approval authority and manage reach, shared by recording and withdrawal. */
import type { IdGenerator, ShipId } from '@aeolus-fleet/common';

import { isShipCaller, type Caller } from '../shared/caller.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { checkManage, type CheckManageTx, type NotReachable } from './check-reach.js';
import { findShipWithOwnerHeld } from './held-ship.js';
import type { ShipRepository } from './ports.js';

export interface ApprovalAuthorityTx extends Omit<CheckManageTx, 'ships'> {
  ships: ShipRepository;
}

export type ApprovalAuthorityRefusal = NotReachable | DomainError<'SCOPE_NOT_HELD' | 'SHIP_NOT_FOUND' | 'SHIP_ALREADY_RETIRED'>;

/** Hold ship actors so scope changes and retirement cannot split their grant check from its commit. */
export async function commissionApprovalAuthority(
  deps: { tx: ApprovalAuthorityTx; ids: IdGenerator },
  input: { caller: Caller; commissionerId: ShipId; at: Date; isOwnWithdrawal: boolean },
): Promise<Result<Caller, ApprovalAuthorityRefusal>> {
  const { tx } = deps;
  let caller = input.caller;
  if (isShipCaller(caller)) {
    const ship = await findShipWithOwnerHeld(tx, { fleetId: caller.fleetId, shipId: caller.shipId });
    if (!ship) {
      return refuse('SHIP_NOT_FOUND', 'The approving ship does not exist');
    }
    if (ship.retiredAt !== null) {
      return refuse('SHIP_ALREADY_RETIRED', 'A retired ship cannot approve or withdraw commission rights');
    }
    caller = { ...caller, scopes: ship.scopes };
  }
  if (!input.isOwnWithdrawal) {
    for (const scope of ['scopes:grant', 'fleet:commission', 'fleet:on-behalf']) {
      if (!caller.scopes.includes(scope)) {
        return refuse('SCOPE_NOT_HELD', `Approving commission rights needs ${scope}`);
      }
    }
  }
  const commissioner = await findShipWithOwnerHeld(tx, { fleetId: caller.fleetId, shipId: input.commissionerId });
  if (!commissioner) {
    return refuse('SHIP_NOT_FOUND', 'The permitted commissioner does not exist in this fleet');
  }
  const managed = await checkManage(deps, { manager: caller, shipId: input.commissionerId, at: input.at });
  return managed.isOk ? ok(caller) : managed;
}
