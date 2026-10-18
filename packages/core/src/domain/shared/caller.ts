import type { ConsoleSessionId, FleetId, LeaseId, Scope, ScopeName, ShipId, ShipKind } from '@aeolus-fleet/common';

/**
 * Who is calling. Every caller is a ship (ADR 0012), resolved from its crew
 * token or from a console session. Kind and scopes come from the server, never
 * from the request.
 */
export interface Caller {
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
 * A caller that came with the crew token `register` gave it: one session
 * crewing one ship under one lease (ADR 0015). A receive claims deliveries
 * for that lease, so they are the crew's, not merely the ship's.
 */
export interface Crew extends Caller {
  leaseId: LeaseId;
}

export function hasScope(caller: Caller, scope: Scope): boolean {
  return caller.scopes.includes(scope);
}

/** Whether the caller crews its ship under a lease: a crew token's crew, or argo's console session. */
export function isCrew(caller: Caller): caller is Crew {
  return 'leaseId' in caller;
}
