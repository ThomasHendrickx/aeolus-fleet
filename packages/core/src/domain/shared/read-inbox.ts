import { PAGE_SIZE_DEFAULT, type DeliveryId, type InboxFilter } from '@aeolus-fleet/common';

import { readsMessage, type ReadReachOf, type ShipRepository } from '../registry/public.js';
import { isShipCaller, type Caller } from './caller.js';
import type { InboxEntry, ShipHistory } from './history.js';
import type { Page } from './page.js';

export type ReadInbox = (caller: Caller, input: { filter: InboxFilter; cursor?: DeliveryId; limit?: number }) => Promise<Page<InboxEntry, DeliveryId>>;

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
 * argo's. The caller's scope (fleet:read) is checked before this runs.
 */
export function createReadInbox(deps: { history: ShipHistory; ships: Pick<ShipRepository, 'findOperatorShip'>; readReach: ReadReachOf }): ReadInbox {
  return async (caller, { filter, cursor, limit = PAGE_SIZE_DEFAULT }) => {
    if (isShipCaller(caller) && caller.kind !== 'viewer') {
      return deps.history.inbox(caller.fleetId, { shipId: caller.shipId, filter, cursor, limit });
    }
    const argo = await deps.ships.findOperatorShip(caller.fleetId);
    if (!argo) {
      return { items: [], nextCursor: null };
    }
    const [inbox, reach] = await Promise.all([deps.history.inbox(caller.fleetId, { shipId: argo.id, filter, cursor, limit }), deps.readReach(caller)]);
    return {
      items: inbox.items.filter((entry) => readsMessage(reach, { senderId: entry.message.sender.id, recipient: { kind: 'ship', shipId: argo.id }, claimedBy: null })),
      nextCursor: inbox.nextCursor,
    };
  };
}
