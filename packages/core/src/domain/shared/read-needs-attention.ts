import { PAGE_SIZE_DEFAULT, type DeliveryId, type ShipId } from '@aeolus-fleet/common';

import { readsMessage, type ReadReachOf } from '../registry/public.js';
import type { Caller } from './caller.js';
import { partiesOf, withPing, type NeedsAttentionState, type ShipHistory, type ShownNeedsAttentionEntry } from './history.js';
import type { Page } from './page.js';

export type ReadNeedsAttention = (
  caller: Caller,
  input: { shipId?: ShipId; state?: NeedsAttentionState; cursor?: DeliveryId; limit?: number },
) => Promise<Page<ShownNeedsAttentionEntry, DeliveryId>>;

/**
 * Use case: a page of Needs attention, the undeliverable or not handled
 * deliveries of the caller's fleet, or of one ship for its page, oldest
 * first, each with its state and whole message, telling whether it is a
 * ping, for the operator to resend or dismiss. Abandoned deliveries are never
 * listed: they stay in the timelines only. Only the deliveries whose message
 * the caller reads (decision 0034). The caller's scope (fleet:read) is
 * checked before this runs.
 */
export function createReadNeedsAttention(deps: { history: ShipHistory; readReach: ReadReachOf }): ReadNeedsAttention {
  return async (caller, { shipId, state, cursor, limit = PAGE_SIZE_DEFAULT }) => {
    const [page, reach] = await Promise.all([deps.history.needsAttention(caller.fleetId, { shipId, state, cursor, limit }), deps.readReach(caller)]);
    return {
      items: page.items.filter((entry) => readsMessage(reach, partiesOf(entry.message, entry.ship))).map((entry) => ({ ...entry, message: withPing(entry.message) })),
      nextCursor: page.nextCursor,
    };
  };
}
