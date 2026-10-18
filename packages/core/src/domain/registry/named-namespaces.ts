import type { FleetId } from '@aeolus-fleet/common';

import type { ScopeNamespaceRepository, ShipRepository } from './ports.js';
import type { ScopeNamespace } from './scope-namespace.js';

export interface NamedNamespacesTx {
  ships: Pick<ShipRepository, 'find'>;
  scopeNamespaces: Pick<ScopeNamespaceRepository, 'lockNamespace' | 'find'>;
}

/**
 * The plugin namespaces the scopes name, with their declarers' names, by
 * namespace, each locked in name order: a declaration that removes one of
 * the scopes waits until the unit of work ends (decision 0046).
 */
export async function lockNamedNamespaces(
  tx: NamedNamespacesTx,
  at: { fleetId: FleetId; scopes: readonly string[] },
): Promise<Map<string, { namespace: ScopeNamespace; declarerName: string }>> {
  const namespaces = new Map<string, { namespace: ScopeNamespace; declarerName: string }>();
  const named = [...new Set(at.scopes.filter((scope) => scope.includes(':')).map((scope) => scope.slice(0, scope.indexOf(':'))))].toSorted();
  for (const name of named) {
    await tx.scopeNamespaces.lockNamespace(at.fleetId, name);
    const namespace = await tx.scopeNamespaces.find(at.fleetId, name);
    if (namespace) {
      const declarer = await tx.ships.find(at.fleetId, namespace.declaredBy);
      namespaces.set(name, { namespace, declarerName: declarer?.name ?? namespace.declaredBy });
    }
  }
  return namespaces;
}
