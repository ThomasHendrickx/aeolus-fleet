import { PAGE_SIZE_DEFAULT, type DeliveryId, type ShipId } from '@aeolus-fleet/common';

import { readsMessage, type ReadReachOf } from '../registry/public.js';
import type { Caller } from './caller.js';
import { partiesOf, withPing, type NeedsAttentionState, type ShipHistory, type ShownNeedsAttentionEntry } from './history.js';
import type { Page } from './page.js';
import { listedNeedsAttention } from './plain-history.js';
import { ok, type Result } from './result.js';
import type { ListedPayload, PayloadSealing } from '../messaging/public.js';

export type ReadNeedsAttention = (
  caller: Caller,
  input: { shipId?: ShipId; state?: NeedsAttentionState; cursor?: DeliveryId; limit?: number },
) => Promise<Result<Page<ShownNeedsAttentionEntry<ListedPayload>, DeliveryId>, never>>;

/**
 * Use case: a page of Needs attention, the undeliverable or not handled
 * deliveries of the caller's fleet, or of one ship for its page, oldest
 * first, each with its state and whole message, telling whether it is a
 * ping, for the operator to resend or dismiss. Abandoned deliveries are never
 * listed: they stay in the timelines only. Only the deliveries whose message
 * the caller reads (decision 0034). The caller's scope (fleet:read) is
 * checked before this runs. In a sealed fleet each payload is unsealed, or
 * marked unreadable when its key cannot be had (decision 0068, B9).
 */
export function createReadNeedsAttention(deps: { history: ShipHistory; readReach: ReadReachOf; sealing: PayloadSealing }): ReadNeedsAttention {
  return async (caller, { shipId, state, cursor, limit = PAGE_SIZE_DEFAULT }) => {
    const [page, reach] = await Promise.all([deps.history.needsAttention(caller.fleetId, { shipId, state, cursor, limit }), deps.readReach(caller)]);
    const entries = page.items.filter((entry) => readsMessage(reach, partiesOf(entry.message, entry.ship)));
    const listed = await listedNeedsAttention({ sealing: deps.sealing, fleetId: caller.fleetId }, entries);
    return ok({ items: listed.map((entry) => ({ ...entry, message: withPing(entry.message) })), nextCursor: page.nextCursor });
  };
}
