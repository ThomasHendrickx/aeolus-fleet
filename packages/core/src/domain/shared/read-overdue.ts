import type { Caller } from './caller.js';
import { withPing, type ShipHistory, type ShownOverdueEntry } from './history.js';

export type ReadOverdue = (caller: Caller) => Promise<ShownOverdueEntry[]>;

/**
 * Use case: the deliveries of the caller's fleet argo was told are overdue by
 * the 10 and 60 minute clocks (decision 0040), oldest told first, for Needs
 * attention. Each clears by itself once its delivery leaves the state it was
 * told in or its lease ends; there is nothing to resend or dismiss. The
 * caller's scope (fleet:read) is checked before this runs.
 */
export function createReadOverdue(deps: { history: ShipHistory }): ReadOverdue {
  return async (caller) => (await deps.history.overdue(caller.fleetId)).map((entry) => ({ ...entry, message: withPing(entry.message) }));
}
