import type { IdGenerator, ShipId } from '@aeolus-fleet/common';

import { actorOf, isShipCaller, type Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { checkManage, keepingReachRefusal, type CheckManageTx, type NotReachable } from './check-reach.js';
import type { ScopeNamespaceRepository, ShipRepository } from './ports.js';
import { grantScopes, type GrantScopesRefusal } from './scope-grant.js';
import { lockNamedNamespaces } from './named-namespaces.js';

export interface GrantScopesTx extends Omit<CheckManageTx, 'ships'> {
  ships: Pick<ShipRepository, 'find' | 'findForUpdate' | 'setScopes'>;
  scopeNamespaces: Pick<ScopeNamespaceRepository, 'lockNamespace' | 'find'>;
  events: EventLog;
}

export type GrantScopes = (
  caller: Caller,
  input: { shipId: ShipId; grant: readonly string[]; revoke: readonly string[] },
) => Promise<Result<{ scopes: readonly string[] }, GrantScopesUseCaseRefusal>>;

export type GrantScopesUseCaseRefusal = GrantScopesRefusal | NotReachable | DomainError<'SHIP_NOT_FOUND'>;

/**
 * Use case: any actor grants and revokes scopes on a live ship of its fleet
 * within its manage reach (decisions 0046, 0053), within what it may grant,
 * read from the server or its checked token. A refused reach keeps its record.
 * Its scope (scopes:grant) is checked before this runs. In one unit of work,
 * holding the ship, then each plugin namespace the scopes name, so a
 * declaration that removes a scope waits: the ship's scopes and
 * ScopesChanged. The ship's crew holds them from its next call.
 */
export function createGrantScopes(deps: { uow: UnitOfWork<GrantScopesTx>; clock: Clock; ids: IdGenerator }): GrantScopes {
  return (caller, input) =>
    keepingReachRefusal(deps.uow, async (tx): Promise<Result<{ scopes: readonly string[] }, GrantScopesUseCaseRefusal>> => {
      const { fleetId } = caller;
      const ship = await tx.ships.findForUpdate(fleetId, input.shipId);
      if (!ship) {
        return refuse('SHIP_NOT_FOUND', `Ship ${input.shipId} does not exist`);
      }
      const at = deps.clock.now();
      const managed = await checkManage({ tx, ids: deps.ids }, { manager: caller, shipId: ship.id, at });
      if (!managed.isOk) {
        return managed;
      }
      const namespaces = await lockNamedNamespaces(tx, { fleetId, scopes: [...input.grant, ...input.revoke] });
      const granter = { shipId: isShipCaller(caller) ? caller.shipId : null, isOperator: caller.kind === 'operator', scopes: caller.scopes };
      const granted = grantScopes(
        { ship, granter, grant: input.grant, revoke: input.revoke, at, actor: actorOf(caller) },
        { namespaces },
      );
      if (!granted.isOk) {
        return granted;
      }
      if (granted.value.events.length > 0) {
        await tx.ships.setScopes({ fleetId, shipId: ship.id, scopes: granted.value.ship.scopes });
      }
      for (const event of granted.value.events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok({ scopes: granted.value.ship.scopes });
    });
}
