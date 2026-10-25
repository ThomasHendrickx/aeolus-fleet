import type { IdGenerator } from '@aeolus-fleet/common';

import { actorOf, type Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import type { DomainError } from '../shared/errors.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { namespaceOf, removeScope } from './defined-scope.js';
import type { DefinedScopeRepository, ScopeNamespaceRepository, ShipRepository } from './ports.js';

export interface RemoveScopeTx {
  ships: Pick<ShipRepository, 'countHolding'>;
  scopeNamespaces: Pick<ScopeNamespaceRepository, 'lockNamespace'>;
  definedScopes: Pick<DefinedScopeRepository, 'find' | 'remove'>;
  events: EventLog;
}

export type RemoveScope = (caller: Caller, input: { scope: string }) => Promise<Result<null, DomainError<'SCOPE_NOT_DEFINED' | 'SCOPE_HELD'>>>;

/**
 * Use case: any actor removes one of the fleet's scopes, refused while an
 * active ship holds it (design gateway-scopes, 4.1). Its scope
 * (scopes:define) is checked before this runs. In one unit of work, holding
 * the scope's namespace, so a grant of it waits and then finds it gone: the
 * removal and ScopeRemoved.
 */
export function createRemoveScope(deps: { uow: UnitOfWork<RemoveScopeTx>; clock: Clock; ids: IdGenerator }): RemoveScope {
  return (caller, input) =>
    deps.uow.run(async (tx): Promise<Result<null, DomainError<'SCOPE_NOT_DEFINED' | 'SCOPE_HELD'>>> => {
      const { fleetId } = caller;
      await tx.scopeNamespaces.lockNamespace(fleetId, namespaceOf(input.scope));
      const removed = removeScope(await tx.definedScopes.find(fleetId, input.scope), {
        scope: input.scope,
        holders: await tx.ships.countHolding(fleetId, input.scope),
        at: deps.clock.now(),
        actor: actorOf(caller),
      });
      if (!removed.isOk) {
        return removed;
      }
      await tx.definedScopes.remove(fleetId, input.scope);
      for (const event of removed.value.events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok(null);
    });
}
