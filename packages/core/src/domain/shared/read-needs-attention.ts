import type { Caller } from './caller.js';
import { withPing, type ShipHistory, type ShownNeedsAttentionEntry } from './history.js';

export type ReadNeedsAttention = (caller: Caller) => Promise<ShownNeedsAttentionEntry[]>;

/**
 * Use case: Needs attention, every undeliverable or not handled delivery of
 * the caller's fleet, oldest first, each with its state and whole message,
 * telling whether it is a ping, for the operator to resend or dismiss. Abandoned deliveries are never listed: they stay in the
 * timelines only. The caller's scope (fleet:read) is checked before this runs.
 */
export function createReadNeedsAttention(deps: { history: ShipHistory }): ReadNeedsAttention {
  return async (caller) => (await deps.history.needsAttention(caller.fleetId)).map((entry) => ({ ...entry, message: withPing(entry.message) }));
}
