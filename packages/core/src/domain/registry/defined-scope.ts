import { isCoreNamespace, RESERVED_NAMESPACES, SCOPE_DESCRIPTION_MAX_LENGTH, SCOPE_NAME_PATTERN, type FleetId, type ScopeName } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import type { Actor, NewEvent } from '../shared/events.js';
import { ok, type Err, type Result } from '../shared/result.js';
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

/**
 * The fleet changes the description of one of its scopes; its name never
 * changes, a new name is a new scope. Refused: a scope the fleet does not
 * have and a malformed description. Writes ScopeDescribed when the
 * description changes.
 */
export function describeScope(
  defined: DefinedScope | undefined,
  input: { scope: string; description: string; at: Date; actor: Actor },
): Result<{ defined: DefinedScope; events: NewEvent[] }, DomainError<'SCOPE_NOT_DEFINED' | 'INVALID_SCOPE_DESCRIPTION'>> {
  const { scope, description, at, actor } = input;
  if (defined === undefined) {
    return notDefined(scope);
  }
  if (!isScopeDescription(description)) {
    return refuse('INVALID_SCOPE_DESCRIPTION', `The description of ${scope} is one line of 1 to ${String(SCOPE_DESCRIPTION_MAX_LENGTH)} characters`);
  }
  if (description === defined.description) {
    return ok({ defined, events: [] });
  }
  return ok({
    defined: { ...defined, description },
    events: [{ fleetId: defined.fleetId, type: 'ScopeDescribed', occurredAt: at, actor, details: { scope, description } }],
  });
}

/**
 * The fleet removes one of its scopes, refused while an active ship holds
 * it (decision 0046), naming how many. Removing the last scope of a
 * namespace frees it. Writes ScopeRemoved.
 */
export function removeScope(
  defined: DefinedScope | undefined,
  input: { scope: string; holders: number; at: Date; actor: Actor },
): Result<{ events: NewEvent[] }, DomainError<'SCOPE_NOT_DEFINED' | 'SCOPE_HELD'>> {
  const { scope, holders, at, actor } = input;
  if (defined === undefined) {
    return notDefined(scope);
  }
  if (holders > 0) {
    const who = holders === 1 ? '1 ship holds' : `${String(holders)} ships hold`;
    return refuse('SCOPE_HELD', `${who} ${scope}: revoke it from ${holders === 1 ? 'it' : 'them'} first`);
  }
  return ok({ events: [{ fleetId: defined.fleetId, type: 'ScopeRemoved', occurredAt: at, actor, details: { scope } }] });
}

function notDefined(scope: string): Err<DomainError<'SCOPE_NOT_DEFINED'>> {
  return refuse('SCOPE_NOT_DEFINED', `The fleet has no scope ${scope}`);
}
