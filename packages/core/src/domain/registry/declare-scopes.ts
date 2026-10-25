import type { IdGenerator } from '@aeolus-fleet/common';

import type { ShipCaller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { recordEvent, shipActor, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import type { DefinedScopeRepository, ScopeNamespaceRepository, ShipRepository } from './ports.js';
import { declareScopes, type DeclaredScope, type DeclareScopesRefusal } from './scope-namespace.js';

export interface DeclareScopesTx {
  ships: Pick<ShipRepository, 'find' | 'findForUpdate' | 'scopesHeldIn'>;
  scopeNamespaces: Pick<ScopeNamespaceRepository, 'lockNamespace' | 'find' | 'findByDeclarer' | 'save'>;
  definedScopes: Pick<DefinedScopeRepository, 'usesNamespace'>;
  events: EventLog;
}

/** The namespace as declared, with its whole list of scopes. */
export interface DeclaredNamespace {
  namespace: string;
  scopes: readonly DeclaredScope[];
}

export type DeclareScopes = (
  caller: ShipCaller,
  input: { namespace: string; scopes: readonly { scope: string; description: string }[] },
) => Promise<Result<DeclaredNamespace, DeclareScopesRefusal>>;

/**
 * Use case: the caller's ship declares its plugin namespace with its whole
 * list of scopes, the first time or again (decision 0046). Its scope
 * (scopes:declare) is checked before this runs. In one unit of work, holding
 * the declaring ship, so one ship never takes two namespaces, then the
 * namespace, so two ships, or a ship and the fleet defining a scope, never
 * both find it free and a grant of its scopes waits: the namespace and
 * ScopesDeclared.
 */
export function createDeclareScopes(deps: { uow: UnitOfWork<DeclareScopesTx>; clock: Clock; ids: IdGenerator }): DeclareScopes {
  return (caller, input) =>
    deps.uow.run(async (tx): Promise<Result<DeclaredNamespace, DeclareScopesRefusal>> => {
      const { fleetId, shipId } = caller;
      await tx.ships.findForUpdate(fleetId, shipId);
      await tx.scopeNamespaces.lockNamespace(fleetId, input.namespace);
      const taken = await tx.scopeNamespaces.find(fleetId, input.namespace);
      const declarer = taken && (await tx.ships.find(fleetId, taken.declaredBy));
      const declared = declareScopes(
        { fleetId, declarer: shipId, namespace: input.namespace, scopes: input.scopes, at: deps.clock.now(), actor: shipActor(shipId) },
        {
          taken: taken && { namespace: taken, declarerName: declarer?.name ?? taken.declaredBy },
          ofDeclarer: await tx.scopeNamespaces.findByDeclarer(fleetId, shipId),
          held: taken === undefined ? [] : await tx.ships.scopesHeldIn(fleetId, input.namespace),
          isUsedByFleet: await tx.definedScopes.usesNamespace(fleetId, input.namespace),
        },
      );
      if (!declared.isOk) {
        return declared;
      }
      await tx.scopeNamespaces.save(declared.value.namespace);
      for (const event of declared.value.events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok({ namespace: declared.value.namespace.namespace, scopes: declared.value.namespace.scopes });
    });
}
