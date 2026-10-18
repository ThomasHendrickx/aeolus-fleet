import { readsMessage, type ReadReachOf } from '../registry/public.js';
import type { Caller } from './caller.js';
import { partiesOf, withPing, type ShipHistory, type ShownNoShipCanTakeEntry } from './history.js';

export type ReadNoShipCanTake = (caller: Caller) => Promise<ShownNoShipCanTakeEntry[]>;

/**
 * Use case: the pending deliveries of the caller's fleet to a type no active
 * ship can take (decision 0041), oldest sent first, for Needs attention. Each
 * clears by itself once a ship of the type can take it; there is nothing to
 * resend or dismiss. Only the deliveries whose message the caller reads
 * (decision 0034). The caller's scope (fleet:read) is checked before this
 * runs.
 */
export function createReadNoShipCanTake(deps: { history: ShipHistory; readReach: ReadReachOf }): ReadNoShipCanTake {
  return async (caller) => {
    const reach = await deps.readReach(caller);
    return (await deps.history.noShipCanTake(caller.fleetId)).filter((entry) => readsMessage(reach, partiesOf(entry.message, null))).map((entry) => ({ ...entry, message: withPing(entry.message) }));
  };
}
