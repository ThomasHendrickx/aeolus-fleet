import type { ConsoleSessionId, FleetId, Scope, ShipId, ShipKind } from '@aeolus-fleet/common';

/**
 * Who is calling. Every caller is a ship (ADR 0012), resolved from its crew
 * token or from a console session. Kind and scopes come from the server, never
 * from the request.
 */
export interface Caller {
  shipId: ShipId;
  fleetId: FleetId;
  kind: ShipKind;
  scopes: readonly Scope[];
  /** Set when the caller signed in through the console rather than calling with a crew token. */
  consoleSessionId?: ConsoleSessionId;
}

export function hasScope(caller: Caller, scope: Scope): boolean {
  return caller.scopes.includes(scope);
}
