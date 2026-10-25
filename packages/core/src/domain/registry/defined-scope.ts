import { isCoreNamespace, RESERVED_NAMESPACES, SCOPE_DESCRIPTION_MAX_LENGTH, SCOPE_NAME_PATTERN, type FleetId, type ScopeName } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import type { Actor, NewEvent } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import { isScopeDescription } from './scope-namespace.js';

/**
 * One of the fleet's own scopes (design gateway-scopes, 4.1): named in the
 * company's words, such as `crm:read-leads`, with a one-line description.
 * Defined, described and removed by any actor holding scopes:define, and
 * never retired with the one who defined it. Its namespace holds the fleet's
 * scopes only, never a plugin's; the fleet has no cap on them.
 */
export interface DefinedScope {
  fleetId: FleetId;
  scope: ScopeName;
  description: string;
}

export type DefineScopeRefusal = DomainError<'INVALID_SCOPE' | 'INVALID_SCOPE_DESCRIPTION' | 'CORE_NAMESPACE' | 'RESERVED_NAMESPACE' | 'NAMESPACE_TAKEN' | 'SCOPE_DEFINED'>;

/** The namespace of a scope: what comes before its colon, or the whole text when it has none. */
export function namespaceOf(scope: string): string {
  const colon = scope.indexOf(':');
  return colon === -1 ? scope : scope.slice(0, colon);
}

/**
 * The fleet defines a scope of its own. Refused, each by name: a malformed
 * scope or description, a core namespace, a namespace reserved for a plugin
 * Aeolus knows, a namespace a plugin declared, and a scope the fleet has.
 * Writes ScopeDefined.
 */
export function defineScope(
  input: { fleetId: FleetId; scope: string; description: string; at: Date; actor: Actor },
  fleet: {
    /** The name of the ship that declared the scope's namespace as a plugin, if one did. */
    declarerName: string | undefined;
    /** The scope as the fleet has it, if it does. */
    defined: DefinedScope | undefined;
  },
): Result<{ defined: DefinedScope; events: NewEvent[] }, DefineScopeRefusal> {
  const { fleetId, scope, description, at, actor } = input;
  if (!SCOPE_NAME_PATTERN.test(scope)) {
    return refuse('INVALID_SCOPE', `${scope} is no scope: <namespace>:<action>, each lowercase letters, digits and hyphens, starting with a letter, at most 32 characters`);
  }
  const namespace = namespaceOf(scope);
  if (isCoreNamespace(namespace)) {
    return refuse('CORE_NAMESPACE', `${namespace} is a core namespace: core alone defines its scopes`);
  }
  if (RESERVED_NAMESPACES.some((reserved) => reserved === namespace)) {
    return refuse('RESERVED_NAMESPACE', `${namespace} is reserved for a plugin Aeolus knows: pick another namespace`);
  }
  if (!isScopeDescription(description)) {
    return refuse('INVALID_SCOPE_DESCRIPTION', `The description of ${scope} is one line of 1 to ${String(SCOPE_DESCRIPTION_MAX_LENGTH)} characters`);
  }
  if (fleet.declarerName !== undefined) {
    return refuse('NAMESPACE_TAKEN', `The namespace ${namespace} is taken, by ${fleet.declarerName}`);
  }
  if (fleet.defined !== undefined) {
    return refuse('SCOPE_DEFINED', `The fleet has ${scope} already: change its description instead`);
  }
  return ok({
    defined: { fleetId, scope, description },
    events: [{ fleetId, type: 'ScopeDefined', occurredAt: at, actor, details: { scope, description } }],
  });
}
