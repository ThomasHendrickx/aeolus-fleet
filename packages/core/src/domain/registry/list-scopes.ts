import { CORE_NAMESPACES, CORE_SCOPE_DESCRIPTIONS, SCOPES, type ShipId } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import { namespaceOf } from './defined-scope.js';
import type { DefinedScopeRepository, ScopeNamespaceRepository, ShipRepository } from './ports.js';
import type { DeclaredScope } from './scope-namespace.js';

/**
 * A namespace as the fleet lists it, saying whose it is: core's, declared by
 * no ship; a plugin's, with its declarer by id and name; or the fleet's own
 * scopes, declared by no ship (design gateway-scopes, 4.1).
 */
export interface ListedNamespace {
  namespace: string;
  kind: 'core' | 'plugin' | 'fleet';
  declaredBy: { id: ShipId; name: string } | null;
  scopes: readonly DeclaredScope[];
}

export type ListScopes = (caller: Caller) => Promise<ListedNamespace[]>;

/**
 * Use case: every namespace of the caller's fleet (decision 0046), for any
 * actor, so pagasae offers each plugin's scopes and the fleet's own to its
 * groups (0053): the core namespaces first, each with its scopes in catalogue
 * order, then the plugins' and the fleet's by namespace, a plugin's scopes as
 * declared and the fleet's by name. The caller's scope (fleet:read) is
 * checked before this runs.
 */
export function createListScopes(deps: {
  scopeNamespaces: Pick<ScopeNamespaceRepository, 'list'>;
  definedScopes: Pick<DefinedScopeRepository, 'list'>;
  ships: Pick<ShipRepository, 'find'>;
}): ListScopes {
  return async (caller) => {
    const core = CORE_NAMESPACES.map((namespace) => ({
      namespace,
      kind: 'core' as const,
      declaredBy: null,
      scopes: SCOPES.filter((scope) => scope.startsWith(`${namespace}:`)).map((scope) => ({ scope, description: CORE_SCOPE_DESCRIPTIONS[scope] })),
    }));
    const plugins = await Promise.all(
      (await deps.scopeNamespaces.list(caller.fleetId)).map(async ({ namespace, declaredBy, scopes }) => {
        const declarer = await deps.ships.find(caller.fleetId, declaredBy);
        return { namespace, kind: 'plugin' as const, declaredBy: { id: declaredBy, name: declarer?.name ?? declaredBy }, scopes };
      }),
    );
    const fleet = new Map<string, DeclaredScope[]>();
    for (const { scope, description } of await deps.definedScopes.list(caller.fleetId)) {
      const namespace = namespaceOf(scope);
      fleet.set(namespace, [...(fleet.get(namespace) ?? []), { scope, description }]);
    }
    const others: ListedNamespace[] = [...plugins, ...[...fleet].map(([namespace, scopes]) => ({ namespace, kind: 'fleet' as const, declaredBy: null, scopes }))];
    return [...core, ...others.toSorted((first, second) => (first.namespace < second.namespace ? -1 : 1))];
  };
}
