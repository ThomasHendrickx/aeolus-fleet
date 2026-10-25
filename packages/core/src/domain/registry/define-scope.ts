import type { IdGenerator } from '@aeolus-fleet/common';

import { actorOf, type Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { defineScope, namespaceOf, type DefineScopeRefusal } from './defined-scope.js';
import type { DefinedScopeRepository, ScopeNamespaceRepository, ShipRepository } from './ports.js';

export interface DefineScopeTx {
  ships: Pick<ShipRepository, 'find'>;
  scopeNamespaces: Pick<ScopeNamespaceRepository, 'lockNamespace' | 'find'>;
  definedScopes: Pick<DefinedScopeRepository, 'find' | 'save'>;
  events: EventLog;
}

export type DefineScope = (caller: Caller, input: { scope: string; description: string }) => Promise<Result<{ scope: string; description: string }, DefineScopeRefusal>>;

/**
 * Use case: any actor defines a scope of the fleet's own (design
 * gateway-scopes, 4.1). Its scope (scopes:define) is checked before this
 * runs. In one unit of work, holding the scope's namespace, so a plugin
 * declaring the same namespace waits and then finds it the fleet's: the
 * scope and ScopeDefined.
 */
export function createDefineScope(deps: { uow: UnitOfWork<DefineScopeTx>; clock: Clock; ids: IdGenerator }): DefineScope {
  return (caller, input) =>
    deps.uow.run(async (tx): Promise<Result<{ scope: string; description: string }, DefineScopeRefusal>> => {
      const { fleetId } = caller;
      const namespace = namespaceOf(input.scope);
      await tx.scopeNamespaces.lockNamespace(fleetId, namespace);
      const declared = await tx.scopeNamespaces.find(fleetId, namespace);
      const declarer = declared && (await tx.ships.find(fleetId, declared.declaredBy));
      const defined = defineScope(
        { fleetId, scope: input.scope, description: input.description, at: deps.clock.now(), actor: actorOf(caller) },
        { declarerName: declared && (declarer?.name ?? declared.declaredBy), defined: await tx.definedScopes.find(fleetId, input.scope) },
      );
      if (!defined.isOk) {
        return defined;
      }
      await tx.definedScopes.save(defined.value.defined);
      for (const event of defined.value.events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok({ scope: defined.value.defined.scope, description: defined.value.defined.description });
    });
}
