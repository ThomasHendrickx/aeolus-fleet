import { scopeNameSchema, scopeSchema, type ScopeName, type ShipId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import type { Actor, NewEvent } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { ScopeNamespace } from './scope-namespace.js';
import type { Ship } from './ship.js';

/** The scopes every agent, person and app ship holds: never revoked (decision 0046). */
const BASE_SCOPES: readonly ScopeName[] = ['messages:send', 'messages:receive'];

export type GrantScopesRefusal = DomainError<
  'INVALID_SCOPE' | 'BASE_SCOPE' | 'SCOPE_NOT_DECLARED' | 'SCOPE_NOT_HELD' | 'SHIP_SCOPES_FIXED' | 'OWN_SHIP_SCOPES' | 'SHIP_ALREADY_RETIRED'
>;

/**
 * Who grants: a ship by its id, or an account or the installation, with none;
 * argo holds every scope, plugin scopes included (decision 0046).
 */
export interface Granter {
  shipId: ShipId | null;
  isOperator: boolean;
  scopes: readonly ScopeName[];
}

/**
 * A granter grants and revokes scopes on a live ship (decisions 0046, 0053),
 * each within what it may grant: a scope it holds, or a declared scope of a
 * plugin namespace it declared. Revoking follows the same rule. Refused: a malformed or unknown
 * scope, one both granted and revoked, revoking sending or receiving, argo's
 * and the viewer's scopes, the granter's own ship and a retired ship. Writes
 * ScopesChanged when anything changes.
 */
export function grantScopes(
  input: {
    ship: Ship;
    granter: Granter;
    grant: readonly string[];
    revoke: readonly string[];
    at: Date;
    actor: Actor;
  },
  fleet: {
    /** The plugin namespaces the granted and revoked scopes name, with their declarers' names, by namespace. */
    namespaces: ReadonlyMap<string, { namespace: ScopeNamespace; declarerName: string }>;
    /** Which of the granted and revoked scopes the fleet defined as its own (design gateway-scopes, 4.1). */
    defined: ReadonlySet<ScopeName>;
  },
): Result<{ ship: Ship; events: NewEvent[] }, GrantScopesRefusal> {
  const { ship, granter, at, actor } = input;
  if (ship.kind === 'operator' || ship.kind === 'viewer') {
    return refuse('SHIP_SCOPES_FIXED', `${ship.name}'s scopes are its own: argo holds every scope and the viewer reads`);
  }
  if (ship.id === granter.shipId) {
    return refuse('OWN_SHIP_SCOPES', 'A ship never changes its own scopes');
  }
  if (ship.retiredAt !== null) {
    return refuse('SHIP_ALREADY_RETIRED', `${ship.name} is retired: its scopes stay as they were`);
  }
  for (const scope of [...input.grant, ...input.revoke]) {
    const allowed = mayGrant(scope, { granter, namespaces: fleet.namespaces, defined: fleet.defined });
    if (!allowed.isOk) {
      return allowed;
    }
  }
  const both = input.grant.find((scope) => input.revoke.includes(scope));
  if (both !== undefined) {
    return refuse('INVALID_SCOPE', `${both} is both granted and revoked`);
  }
  const base = input.revoke.find((scope) => BASE_SCOPES.includes(scope));
  if (base !== undefined) {
    return refuse('BASE_SCOPE', `Every ship holds ${base}: it is never revoked`);
  }
  const added = [...new Set(input.grant)].filter((scope) => !ship.scopes.includes(scope));
  const removed = ship.scopes.filter((scope) => input.revoke.includes(scope));
  if (added.length === 0 && removed.length === 0) {
    return ok({ ship, events: [] });
  }
  const changed: Ship = { ...ship, scopes: [...ship.scopes.filter((scope) => !removed.includes(scope)), ...added] };
  return ok({
    ship: changed,
    events: [{ fleetId: ship.fleetId, type: 'ScopesChanged', occurredAt: at, actor, shipId: ship.id, details: { added: added.join(' '), removed: removed.join(' ') } }],
  });
}

/**
 * Whether the granter may grant or revoke the scope, at commission or on a
 * live ship: a core scope it holds, a declared plugin scope it holds or
 * declared (decision 0053), or one of the fleet's own scopes it holds
 * (design gateway-scopes, 4.1): defining a scope never lets an actor grant it.
 */
export function mayGrant(
  scope: string,
  at: { granter: Granter; namespaces: ReadonlyMap<string, { namespace: ScopeNamespace; declarerName: string }>; defined: ReadonlySet<ScopeName> },
): Result<null, DomainError<'INVALID_SCOPE' | 'SCOPE_NOT_DECLARED' | 'SCOPE_NOT_HELD'>> {
  const { granter, namespaces, defined } = at;
  if (!scopeNameSchema.safeParse(scope).success) {
    return refuse('INVALID_SCOPE', `${scope} is no scope: a core scope, or a plugin's <namespace>:<action>`);
  }
  if (scopeSchema.safeParse(scope).success) {
    return granter.isOperator || granter.scopes.includes(scope) ? ok(null) : refuse('SCOPE_NOT_HELD', `You do not hold ${scope}, so you cannot grant it`);
  }
  if (defined.has(scope)) {
    return granter.isOperator || granter.scopes.includes(scope) ? ok(null) : refuse('SCOPE_NOT_HELD', `You do not hold ${scope}, so you cannot grant it`);
  }
  const namespace = scope.slice(0, scope.indexOf(':'));
  const declared = namespaces.get(namespace);
  if (declared?.namespace.scopes.some((each) => each.scope === scope) !== true) {
    return refuse('SCOPE_NOT_DECLARED', `Neither a plugin declared ${scope} nor the fleet defined it`);
  }
  if (!granter.isOperator && !granter.scopes.includes(scope) && declared.namespace.declaredBy !== granter.shipId) {
    return refuse('SCOPE_NOT_HELD', `You do not hold ${scope}, so you cannot grant it`);
  }
  return ok(null);
}
