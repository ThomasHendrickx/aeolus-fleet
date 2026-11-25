/** Resolve the scope names held by an actor at the time of a read or dispatch. */
import { SCOPES, type ScopeName } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import type { DefinedScopeRepository, ScopeNamespaceRepository } from './ports.js';

export interface ScopeCatalogue {
  scopeNamespaces: Pick<ScopeNamespaceRepository, 'list'>;
  definedScopes: Pick<DefinedScopeRepository, 'list'>;
}

type ScopeHolder = Pick<Caller, 'fleetId' | 'kind' | 'scopes'>;
export type EffectiveScopes = (holder: ScopeHolder) => Promise<readonly ScopeName[]>;

export async function effectiveScopes(catalogue: ScopeCatalogue, holder: ScopeHolder): Promise<readonly ScopeName[]> {
  if (holder.kind !== 'operator') {
    return holder.scopes;
  }

  const [namespaces, defined] = await Promise.all([catalogue.scopeNamespaces.list(holder.fleetId), catalogue.definedScopes.list(holder.fleetId)]);
  const declared = namespaces.flatMap(({ scopes }) => scopes.map(({ scope }) => scope));
  return [...SCOPES, ...[...declared, ...defined.map(({ scope }) => scope)].sort()];
}
