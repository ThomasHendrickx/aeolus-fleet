import { readsMessage, type ReadReachOf } from '../registry/public.js';
import type { ShipCaller } from './caller.js';
import { partiesOf, withPing, type ShipHistory, type ShownNeedsAttentionEntry } from './history.js';

export type ReadNeedsAttention = (caller: ShipCaller) => Promise<ShownNeedsAttentionEntry[]>;

/**
 * Use case: Needs attention, every undeliverable or not handled delivery of
 * the caller's fleet, oldest first, each with its state and whole message,
 * telling whether it is a ping, for the operator to resend or dismiss. Abandoned deliveries are never listed: they stay in the
 * timelines only. Only the deliveries whose message the caller reads
 * (decision 0034). The caller's scope (fleet:read) is checked before this runs.
 */
export function createReadNeedsAttention(deps: { history: ShipHistory; readReach: ReadReachOf }): ReadNeedsAttention {
  return async (caller) => {
    const reach = await deps.readReach(caller);
    return (await deps.history.needsAttention(caller.fleetId)).filter((entry) => readsMessage(reach, partiesOf(entry.message, entry.ship))).map((entry) => ({ ...entry, message: withPing(entry.message) }));
  };
}
