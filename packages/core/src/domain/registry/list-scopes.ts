import { CORE_NAMESPACES, CORE_SCOPE_DESCRIPTIONS, SCOPES, type ShipId } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import type { ScopeNamespaceRepository, ShipRepository } from './ports.js';
import type { DeclaredScope } from './scope-namespace.js';

/** A namespace as the fleet lists it: a core one, declared by no ship, or a plugin's, with its declarer by id and name. */
export interface ListedNamespace {
  namespace: string;
  declaredBy: { id: ShipId; name: string } | null;
  scopes: readonly DeclaredScope[];
}

export type ListScopes = (caller: Caller) => Promise<ListedNamespace[]>;

/**
 * Use case: every namespace of the caller's fleet (decision 0046), for any
 * actor, so pagasae offers each plugin's scopes to its groups (0053): the core
 * namespaces first, each with its scopes in catalogue order, then each
 * plugin's by namespace, with its scopes as declared. The caller's scope
 * (fleet:read) is checked before this runs.
 */
export function createListScopes(deps: { scopeNamespaces: Pick<ScopeNamespaceRepository, 'list'>; ships: Pick<ShipRepository, 'find'> }): ListScopes {
  return async (caller) => {
    const core = CORE_NAMESPACES.map((namespace) => ({
      namespace,
      declaredBy: null,
      scopes: SCOPES.filter((scope) => scope.startsWith(`${namespace}:`)).map((scope) => ({ scope, description: CORE_SCOPE_DESCRIPTIONS[scope] })),
    }));
    const plugins = await Promise.all(
      (await deps.scopeNamespaces.list(caller.fleetId)).map(async ({ namespace, declaredBy, scopes }) => {
        const declarer = await deps.ships.find(caller.fleetId, declaredBy);
        return { namespace, declaredBy: { id: declaredBy, name: declarer?.name ?? declaredBy }, scopes };
      }),
    );
    return [...core, ...plugins];
  };
}
