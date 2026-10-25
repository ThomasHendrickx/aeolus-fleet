import type { FleetId, ScopeName } from '@aeolus-fleet/common';

import type { DefinedScopeRepository, ScopeNamespaceRepository, ShipRepository } from './ports.js';
import type { ScopeNamespace } from './scope-namespace.js';

export interface NamedNamespacesTx {
  ships: Pick<ShipRepository, 'find'>;
  scopeNamespaces: Pick<ScopeNamespaceRepository, 'lockNamespace' | 'find'>;
  definedScopes: Pick<DefinedScopeRepository, 'find'>;
}

/** What the fleet holds of the namespaces some scopes name: the plugins' namespaces, and which of the scopes are the fleet's own. */
export interface NamedNamespaces {
  /** The plugin namespaces the scopes name, with their declarers' names, by namespace. */
  namespaces: Map<string, { namespace: ScopeNamespace; declarerName: string }>;
  /** The scopes the fleet defined as its own (design gateway-scopes, 4.1). */
  defined: Set<ScopeName>;
}

/**
 * The plugin namespaces the scopes name, with their declarers' names, by
 * namespace, and which of the scopes the fleet defined, each namespace
 * locked in name order: a declaration that removes one of the scopes, or a
 * removal of one of the fleet's, waits until the unit of work ends
 * (decision 0046).
 */
export async function lockNamedNamespaces(tx: NamedNamespacesTx, at: { fleetId: FleetId; scopes: readonly string[] }): Promise<NamedNamespaces> {
  const namespaces = new Map<string, { namespace: ScopeNamespace; declarerName: string }>();
  const defined = new Set<ScopeName>();
  const named = [...new Set(at.scopes.filter((scope) => scope.includes(':')).map((scope) => scope.slice(0, scope.indexOf(':'))))].toSorted();
  for (const name of named) {
    await tx.scopeNamespaces.lockNamespace(at.fleetId, name);
    const namespace = await tx.scopeNamespaces.find(at.fleetId, name);
    if (namespace) {
      const declarer = await tx.ships.find(at.fleetId, namespace.declaredBy);
      namespaces.set(name, { namespace, declarerName: declarer?.name ?? namespace.declaredBy });
    }
  }
  for (const scope of new Set(at.scopes.filter((each) => named.some((name) => each.startsWith(`${name}:`))))) {
    if ((await tx.definedScopes.find(at.fleetId, scope)) !== undefined) {
      defined.add(scope);
    }
  }
  return { namespaces, defined };
}
