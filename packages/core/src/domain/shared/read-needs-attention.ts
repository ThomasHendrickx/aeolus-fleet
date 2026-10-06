import type { Caller } from './caller.js';
import type { ShipHistory, UndeliverableEntry } from './history.js';

export type ReadNeedsAttention = (caller: Caller) => Promise<UndeliverableEntry[]>;

/**
 * Use case: Needs attention, every undeliverable delivery of the caller's
 * fleet, oldest first, each with its whole message, for the operator to
 * resend or dismiss. Abandoned deliveries are never listed: they stay in the
 * timelines only. The caller's scope (fleet:read) is checked before this runs.
 */
export function createReadNeedsAttention(deps: { history: ShipHistory }): ReadNeedsAttention {
  return (caller) => deps.history.undeliverable(caller.fleetId);
}
