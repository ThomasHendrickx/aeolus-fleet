import { PAGE_SIZE_DEFAULT, type DeliveryId, type InboxFilter, type ShipId } from '@aeolus-fleet/common';

import { readsMessage, type ReadReachOf, type ShipRepository } from '../registry/public.js';
import { isShipCaller, type Caller } from './caller.js';
import type { HistoryParty, InboxEntry, ShipHistory } from './history.js';
import { listedInboxEntries } from './plain-history.js';
import { ok, type Result } from './result.js';
import type { ListedPayload, PayloadSealing } from '../messaging/public.js';
import type { Page } from './page.js';

export type ReadInbox = (caller: Caller, input: { filter: InboxFilter; cursor?: DeliveryId; limit?: number }) => Promise<Result<Page<InboxEntry<ListedPayload>, DeliveryId>, never>>;

/**
 * Whose inbox the caller reads and which of its messages: a ship its own,
 * whole; a viewer session or an account argo's, by its read reach. Undefined
 * when the fleet has no argo.
 */
export async function inboxReadOf(
  deps: { ships: Pick<ShipRepository, 'findOperatorShip'>; readReach: ReadReachOf },
  caller: Caller,
): Promise<{ shipId: ShipId; reads: (entry: { message: { sender: HistoryParty } }) => boolean } | undefined> {
  if (isShipCaller(caller) && caller.kind !== 'viewer') {
    return { shipId: caller.shipId, reads: () => true };
  }
  const argo = await deps.ships.findOperatorShip(caller.fleetId);
  if (!argo) {
    return undefined;
  }
  const reach = await deps.readReach(caller);
  return { shipId: argo.id, reads: (entry) => readsMessage(reach, { senderId: entry.message.sender.id, recipient: { kind: 'ship', shipId: argo.id }, claimedBy: null }) };
}

/**
 * Use case: a page of the caller's own inbox, for the operator inbox of argo
 * (docs/blueprint.md, "Inbox"): the messages addressed to it that the filter
 * keeps (open, done or all), newest first, each with when it was read, when
 * and by which reply it was done, and its whole payload. Messages to its type
 * are its type's queue, not its inbox. A viewer session, which receives
 * nothing, reads argo's inbox instead, read-only (decision 0022), and only the
 * messages its read reach reads: none while argo has turned viewer reading
 * off (decision 0034). An account holding fleet:read reads argo's inbox the
 * same way, by its own read reach (header design, C3); Done and Reply stay
 * argo's. The caller's scope (fleet:read) is checked before this runs. In a
 * sealed fleet each payload is unsealed, or marked unreadable when its key
 * cannot be had (decision 0068, B9).
 */
export function createReadInbox(deps: { history: ShipHistory; ships: Pick<ShipRepository, 'findOperatorShip'>; readReach: ReadReachOf; sealing: PayloadSealing }): ReadInbox {
  return async (caller, { filter, cursor, limit = PAGE_SIZE_DEFAULT }) => {
    const inbox = await inboxReadOf(deps, caller);
    if (!inbox) {
      return ok({ items: [], nextCursor: null });
    }
    const page = await deps.history.inbox(caller.fleetId, { shipId: inbox.shipId, filter, cursor, limit });
    return ok({ items: await listedInboxEntries({ sealing: deps.sealing, fleetId: caller.fleetId }, page.items.filter(inbox.reads)), nextCursor: page.nextCursor });
  };
}
