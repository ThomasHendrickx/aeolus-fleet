import type { Caller } from './caller.js';
import { withPing, type ShipHistory, type ShownNoShipCanTakeEntry } from './history.js';

export type ReadNoShipCanTake = (caller: Caller) => Promise<ShownNoShipCanTakeEntry[]>;

/**
 * Use case: the pending deliveries of the caller's fleet to a type no active
 * ship can take (decision 0041), oldest sent first, for Needs attention. Each
 * clears by itself once a ship of the type can take it; there is nothing to
 * resend or dismiss. The caller's scope (fleet:read) is checked before this
 * runs.
 */
export function createReadNoShipCanTake(deps: { history: ShipHistory }): ReadNoShipCanTake {
  return async (caller) => (await deps.history.noShipCanTake(caller.fleetId)).map((entry) => ({ ...entry, message: withPing(entry.message) }));
}
