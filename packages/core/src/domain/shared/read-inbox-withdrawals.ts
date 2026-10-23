import { PAGE_SIZE_DEFAULT, type DeliveryId } from '@aeolus-fleet/common';

import type { ReadReachOf, ShipRepository } from '../registry/public.js';
import type { Caller } from './caller.js';
import type { InboxEntry, ShipHistory } from './history.js';
import type { Page } from './page.js';
import { inboxReadOf } from './read-inbox.js';

export type ReadInboxWithdrawals = (caller: Caller, input: { questionId: string; cursor?: DeliveryId; limit?: number }) => Promise<Page<InboxEntry, DeliveryId>>;

/**
 * Use case: a page of the messages to the caller's own inbox, argo's for the
 * console, that withdraw or replace a question (decision 0038), oldest first,
 * found by the question's uuid: what makes the question stale, whatever their
 * filter. Only those the caller's read reach reads (decision 0034). The
 * caller's scope (fleet:read) is checked before this runs.
 */
export function createReadInboxWithdrawals(deps: { history: ShipHistory; ships: Pick<ShipRepository, 'findOperatorShip'>; readReach: ReadReachOf }): ReadInboxWithdrawals {
  return async (caller, { questionId, cursor, limit = PAGE_SIZE_DEFAULT }) => {
    const inbox = await inboxReadOf(deps, caller);
    if (!inbox) {
      return { items: [], nextCursor: null };
    }
    const page = await deps.history.inboxWithdrawals(caller.fleetId, { shipId: inbox.shipId, questionId, cursor, limit });
    return { items: page.items.filter(inbox.reads), nextCursor: page.nextCursor };
  };
}
