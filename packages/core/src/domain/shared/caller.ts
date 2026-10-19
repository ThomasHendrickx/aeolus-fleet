import type { AccountId, ConsoleSessionId, FleetId, LeaseId, Scope, ScopeName, ShipId, ShipKind } from '@aeolus-fleet/common';

/**
 * Who a call is authorised for: its actor (decision 0057). A ship, by its
 * crew token or a console sign-in; an account, by the account token pagasae
 * signed for this fleet; or the installation, by the installation token.
 * Scopes and reach come from the server or the checked token, never from
 * the request, and are checked the same way for each.
 */
export type Caller = ShipCaller | AccountCaller | InstallationCaller;

/** A ship as the actor of a call, resolved from its crew token or from a console session. */
export interface ShipCaller {
  shipId: ShipId;
  fleetId: FleetId;
  kind: ShipKind;
  /** Core scopes and plugin scopes; core checks only its own (decision 0046). */
  scopes: readonly ScopeName[];
  /** Set when the caller signed in through the console rather than calling with a crew token. */
  consoleSessionId?: ConsoleSessionId;
  /** The plugin ship that reads on behalf of this ship, with this ship's read reach (decision 0034); absent for a ship's own call. */
  askedBy?: ShipId;
}

/**
 * An account as the actor of a call, as its account token says (decision
 * 0058): core stores no account. It reaches by the values of the label
 * `group` its token carries, and as the owner of what its person ship owns.
 */
export interface AccountCaller {
  kind: 'account';
  accountId: AccountId;
  fleetId: FleetId;
  scopes: readonly ScopeName[];
  /** The values of the label `group` its groups give it in this fleet, by their texts. */
  groupValues: readonly string[];
  /** Its person ship in this fleet, if it has one: a ship owned by it is one the account owns (decision 0057). */
  personShipId: ShipId | null;
  /** The ship that presented the account token, a plugin's page or the gateway, if one did. */
  throughShipId: ShipId | null;
}

/** The installation as the actor of a call in one fleet, with the scopes it holds there (decision 0020). */
export interface InstallationCaller {
  kind: 'installation';
  fleetId: FleetId;
  scopes: readonly ScopeName[];
}

/**
 * A caller that came with the crew token `register` gave it: one session
 * crewing one ship under one lease (ADR 0015). A receive claims deliveries
 * for that lease, so they are the crew's, not merely the ship's.
 */
export interface Crew extends ShipCaller {
  leaseId: LeaseId;
}

export function hasScope(caller: Caller, scope: Scope): boolean {
  return caller.scopes.includes(scope);
}

/** Whether the actor is a ship: what sends, receives, owns, defines labels and declares (decision 0057). */
export function isShipCaller(caller: Caller): caller is ShipCaller {
  return caller.kind !== 'account' && caller.kind !== 'installation';
}

/** Whether the caller crews its ship under a lease: a crew token's crew, or argo's console session. */
export function isCrew(caller: Caller): caller is Crew {
  return 'leaseId' in caller;
}
