import { readsMessage, type ReadReachOf } from '../registry/public.js';
import type { Caller } from './caller.js';
import { partiesOf, withPing, type ShipHistory, type ShownOverdueEntry } from './history.js';

export type ReadOverdue = (caller: Caller) => Promise<ShownOverdueEntry[]>;

/**
 * Use case: the deliveries of the caller's fleet argo was told are overdue by
 * the 10 and 60 minute clocks (decision 0040), oldest told first, for Needs
 * attention. Each clears by itself once its delivery leaves the state it was
 * told in or its lease ends; there is nothing to resend or dismiss. Only the
 * deliveries whose message the caller reads (decision 0034). The caller's
 * scope (fleet:read) is checked before this runs.
 */
export function createReadOverdue(deps: { history: ShipHistory; readReach: ReadReachOf }): ReadOverdue {
  return async (caller) => {
    const reach = await deps.readReach(caller);
    return (await deps.history.overdue(caller.fleetId)).filter((entry) => readsMessage(reach, partiesOf(entry.message, entry.ship))).map((entry) => ({ ...entry, message: withPing(entry.message) }));
  };
}
