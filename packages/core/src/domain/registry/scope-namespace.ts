import {
  isCoreNamespace,
  NAMESPACE_SCOPES_MAX,
  SCOPE_DESCRIPTION_MAX_LENGTH,
  SCOPE_NAME_PATTERN,
  SCOPE_NAMESPACE_PATTERN,
  type FleetId,
  type ScopeName,
  type ShipId,
} from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import type { Actor, NewEvent } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { Ship } from './ship.js';

/** One scope a plugin declared, with its one-line description. */
export interface DeclaredScope {
  scope: ScopeName;
  description: string;
}

/**
 * A plugin's namespace (decision 0046): taken up for good by the ship that
 * declared it, one per ship and unique in the fleet, with its whole list of
 * scopes. Core stores and answers them and never checks them; the plugin
 * enforces them. It goes when its declarer retires.
 */
export interface ScopeNamespace {
  fleetId: FleetId;
  namespace: string;
  declaredBy: ShipId;
  /** In the order the declarer gave them, each once. */
  scopes: readonly DeclaredScope[];
}

export type DeclareScopesRefusal = DomainError<
  'INVALID_SCOPE' | 'INVALID_SCOPE_DESCRIPTION' | 'CORE_NAMESPACE' | 'NAMESPACE_TAKEN' | 'SECOND_NAMESPACE' | 'TOO_MANY_SCOPES' | 'SCOPE_HELD'
>;

/**
 * A ship declares its namespace with its whole list of scopes, the first
 * time or again (decision 0046). Refused: a malformed namespace or scope, a
 * scope of another namespace or twice, a description not on one line, a core
 * namespace, a namespace the fleet uses for its own scopes, a namespace another ship took, a second namespace, more than 20
 * scopes, and removing a scope an active ship holds. Writes ScopesDeclared.
 */
export function declareScopes(
  input: { fleetId: FleetId; declarer: ShipId; namespace: string; scopes: readonly { scope: string; description: string }[]; at: Date; actor: Actor },
  fleet: {
    /** The namespace as the fleet holds it, with its declarer's name, if anyone took it. */
    taken: { namespace: ScopeNamespace; declarerName: string } | undefined;
    /** The namespace the declaring ship took, if any. */
    ofDeclarer: ScopeNamespace | undefined;
    /** The scopes of this namespace an active ship holds. */
    held: readonly ScopeName[];
    /** Whether the fleet has scopes of its own in this namespace (design gateway-scopes, 4.1). */
    isUsedByFleet: boolean;
  },
): Result<{ namespace: ScopeNamespace; events: NewEvent[] }, DeclareScopesRefusal> {
  const { fleetId, declarer, namespace, at, actor } = input;
  if (!SCOPE_NAMESPACE_PATTERN.test(namespace)) {
    return refuse('INVALID_SCOPE', `${namespace} is no namespace: lowercase letters, digits and hyphens, starting with a letter, at most 32 characters`);
  }
  if (isCoreNamespace(namespace)) {
    return refuse('CORE_NAMESPACE', `${namespace} is a core namespace: core alone declares its scopes`);
  }
  if (input.scopes.length > NAMESPACE_SCOPES_MAX) {
    return refuse('TOO_MANY_SCOPES', `A namespace has at most ${String(NAMESPACE_SCOPES_MAX)} scopes`);
  }
  const scopes = declaredScopes(namespace, input.scopes);
  if (!scopes.isOk) {
    return scopes;
  }
  if (fleet.isUsedByFleet) {
    return refuse('NAMESPACE_TAKEN', `The namespace ${namespace} is taken, by the fleet`);
  }
  if (fleet.taken !== undefined && fleet.taken.namespace.declaredBy !== declarer) {
    return refuse('NAMESPACE_TAKEN', `The namespace ${namespace} is taken, by ${fleet.taken.declarerName}`);
  }
  if (fleet.ofDeclarer !== undefined && fleet.ofDeclarer.namespace !== namespace) {
    return refuse('SECOND_NAMESPACE', `This ship declared the namespace ${fleet.ofDeclarer.namespace}: a ship takes up one namespace`);
  }
  const kept = new Set<string>(scopes.value.map(({ scope }) => scope));
  const removedHeld = fleet.held.filter((scope) => !kept.has(scope));
  if (removedHeld.length > 0) {
    return refuse('SCOPE_HELD', `Ships hold ${removedHeld.join(', ')}: revoke it from them first`);
  }
  const declared: ScopeNamespace = { fleetId, namespace, declaredBy: declarer, scopes: scopes.value };
  return ok({
    namespace: declared,
    events: [{ fleetId, type: 'ScopesDeclared', occurredAt: at, actor, shipId: declarer, details: { namespace, scopes: declared.scopes.length } }],
  });
}

/** The scopes as declared, each of the namespace, once, with a description on one line. */
function declaredScopes(
  namespace: string,
  scopes: readonly { scope: string; description: string }[],
): Result<DeclaredScope[], DomainError<'INVALID_SCOPE' | 'INVALID_SCOPE_DESCRIPTION'>> {
  const seen = new Set<string>();
  const declared: DeclaredScope[] = [];
  for (const { scope, description } of scopes) {
    if (!SCOPE_NAME_PATTERN.test(scope) || !scope.startsWith(`${namespace}:`)) {
      return refuse('INVALID_SCOPE', `${scope} is no scope of ${namespace}: ${namespace}:<action>`);
    }
    if (seen.has(scope)) {
      return refuse('INVALID_SCOPE', `${scope} is declared twice`);
    }
    if (!isScopeDescription(description)) {
      return refuse('INVALID_SCOPE_DESCRIPTION', `The description of ${scope} is one line of 1 to ${String(SCOPE_DESCRIPTION_MAX_LENGTH)} characters`);
    }
    seen.add(scope);
    declared.push({ scope, description });
  }
  return ok(declared);
}

/** Whether the description is one line of 1 to 200 characters, as every scope's is (decision 0046). */
export function isScopeDescription(description: string): boolean {
  return description.trim() !== '' && !description.includes('\n') && description.length <= SCOPE_DESCRIPTION_MAX_LENGTH;
}

/**
 * The namespace goes with its retiring declarer (decision 0046): each active
 * ship that holds any of its scopes loses them, keeping its other scopes, one
 * ScopesChanged each.
 */
export function releaseWithDeclarer(namespace: ScopeNamespace, at: { holders: readonly Ship[]; at: Date; actor: Actor }): { ships: Ship[]; events: NewEvent[] } {
  const isOfNamespace = (scope: string) => scope.startsWith(`${namespace.namespace}:`);
  const changed = at.holders.filter((ship) => ship.id !== namespace.declaredBy && ship.scopes.some(isOfNamespace));
  return {
    ships: changed.map((ship) => ({ ...ship, scopes: ship.scopes.filter((scope) => !isOfNamespace(scope)) })),
    events: changed.map((ship) => ({
      fleetId: ship.fleetId,
      type: 'ScopesChanged',
      occurredAt: at.at,
      actor: at.actor,
      shipId: ship.id,
      details: { added: '', removed: ship.scopes.filter(isOfNamespace).join(' ') },
    })),
  };
}
