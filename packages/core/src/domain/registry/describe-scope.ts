import type { IdGenerator } from '@aeolus-fleet/common';

import { actorOf, type Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import type { DomainError } from '../shared/errors.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { describeScope, namespaceOf } from './defined-scope.js';
import type { DefinedScopeRepository, ScopeNamespaceRepository } from './ports.js';

export interface DescribeScopeTx {
  scopeNamespaces: Pick<ScopeNamespaceRepository, 'lockNamespace'>;
  definedScopes: Pick<DefinedScopeRepository, 'find' | 'save'>;
  events: EventLog;
}

export type DescribeScope = (
  caller: Caller,
  input: { scope: string; description: string },
) => Promise<Result<{ scope: string; description: string }, DomainError<'SCOPE_NOT_DEFINED' | 'INVALID_SCOPE_DESCRIPTION'>>>;

/**
 * Use case: any actor changes the description of one of the fleet's scopes
 * (design gateway-scopes, 4.1). Its scope (scopes:define) is checked before
 * this runs. In one unit of work, holding the scope's namespace, so a removal
 * never finds it described back: the description and ScopeDescribed.
 */
export function createDescribeScope(deps: { uow: UnitOfWork<DescribeScopeTx>; clock: Clock; ids: IdGenerator }): DescribeScope {
  return (caller, input) =>
    deps.uow.run(async (tx): Promise<Result<{ scope: string; description: string }, DomainError<'SCOPE_NOT_DEFINED' | 'INVALID_SCOPE_DESCRIPTION'>>> => {
      const { fleetId } = caller;
      await tx.scopeNamespaces.lockNamespace(fleetId, namespaceOf(input.scope));
      const described = describeScope(await tx.definedScopes.find(fleetId, input.scope), { ...input, at: deps.clock.now(), actor: actorOf(caller) });
      if (!described.isOk) {
        return described;
      }
      if (described.value.events.length > 0) {
        await tx.definedScopes.save(described.value.defined);
      }
      for (const event of described.value.events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok({ scope: described.value.defined.scope, description: described.value.defined.description });
    });
}
