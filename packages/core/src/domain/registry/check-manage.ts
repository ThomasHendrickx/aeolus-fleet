import type { IdGenerator, ShipId } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import type { Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { checkManage, keepingReachRefusal, type CheckManageTx, type NotReachable } from './check-reach.js';

export type CheckManageRefusal = DomainError<'SHIP_NOT_FOUND'> | NotReachable;

export type CheckManage = (caller: Caller, input: { shipId: ShipId }) => Promise<Result<undefined, CheckManageRefusal>>;

/**
 * Use case: any actor, with no scope, asks whether it manages a ship now, by
 * the rule every fleet:manage call checks (decision 0034): so the gateway
 * checks an approver's manage reach on a proxy ship before it changes what
 * the ship's tools need (design gateway-scopes 4.2). A refusal keeps its
 * record, as every manage call's does.
 */
export function createCheckManage(deps: { uow: UnitOfWork<CheckManageTx>; clock: Clock; ids: IdGenerator }): CheckManage {
  return (caller, input) =>
    keepingReachRefusal(deps.uow, async (tx): Promise<Result<undefined, CheckManageRefusal>> => {
      const ship = await tx.ships.find(caller.fleetId, input.shipId);
      if (!ship) {
        return refuse('SHIP_NOT_FOUND', `Ship ${input.shipId} does not exist`);
      }
      return checkManage({ tx, ids: deps.ids }, { manager: caller, shipId: ship.id, at: deps.clock.now() });
    });
}
