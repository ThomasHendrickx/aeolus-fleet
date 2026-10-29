import { PAGE_SIZE_DEFAULT, type DeliveryId } from '@aeolus-fleet/common';

import type { ReadReachOf, ShipRepository } from '../registry/public.js';
import type { Caller } from './caller.js';
import type { DomainError } from './errors.js';
import type { InboxEntry, ShipHistory } from './history.js';
import { plainInboxEntries } from './plain-history.js';
import { ok, type Result } from './result.js';
import type { PayloadSealing } from '../messaging/public.js';
import type { Page } from './page.js';
import { inboxReadOf } from './read-inbox.js';

export type ReadInboxWithdrawals = (caller: Caller, input: { questionId: string; cursor?: DeliveryId; limit?: number }) => Promise<Result<Page<InboxEntry, DeliveryId>, DomainError<'KEY_UNAVAILABLE'>>>;

/**
 * Use case: a page of the messages to the caller's own inbox, argo's for the
 * console, that withdraw or replace a question (decision 0038), oldest first,
 * found by the question's uuid: what makes the question stale, whatever their
 * filter. Only those the caller's read reach reads (decision 0034). The
 * caller's scope (fleet:read) is checked before this runs. In a sealed fleet
 * each payload is unsealed (decision 0068, B9).
 */
export function createReadInboxWithdrawals(deps: { history: ShipHistory; ships: Pick<ShipRepository, 'findOperatorShip'>; readReach: ReadReachOf; sealing: PayloadSealing }): ReadInboxWithdrawals {
  return async (caller, { questionId, cursor, limit = PAGE_SIZE_DEFAULT }) => {
    const inbox = await inboxReadOf(deps, caller);
    if (!inbox) {
      return ok({ items: [], nextCursor: null });
    }
    const page = await deps.history.inboxWithdrawals(caller.fleetId, { shipId: inbox.shipId, questionId, cursor, limit });
    const entries = await plainInboxEntries({ sealing: deps.sealing, fleetId: caller.fleetId }, page.items.filter(inbox.reads));
    return entries.isOk ? ok({ items: entries.value, nextCursor: page.nextCursor }) : entries;
  };
}
