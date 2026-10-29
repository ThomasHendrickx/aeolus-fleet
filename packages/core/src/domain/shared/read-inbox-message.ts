import type { DeliveryId } from '@aeolus-fleet/common';

import type { ReadReachOf, ShipRepository } from '../registry/public.js';
import type { Caller } from './caller.js';
import { refuse, type DomainError } from './errors.js';
import type { InboxEntry, ShipHistory } from './history.js';
import { inboxReadOf } from './read-inbox.js';
import { plainInboxEntry } from './plain-history.js';
import type { Result } from './result.js';
import type { PayloadSealing } from '../messaging/public.js';

export type ReadInboxMessage = (caller: Caller, input: { deliveryId: DeliveryId }) => Promise<Result<InboxEntry, DomainError<'DELIVERY_NOT_FOUND' | 'KEY_UNAVAILABLE'>>>;

/**
 * Use case: one message of the caller's own inbox, argo's for the console, by
 * its delivery, as the inbox lists it, whatever its filter: the question the
 * operator answers or opens (docs/blueprint.md, "Inbox"). A delivery not in
 * that inbox, or outside the caller's read reach, is answered as none
 * (decision 0034). The caller's scope (fleet:read) is checked before this runs.
 * In a sealed fleet its payloads are unsealed (decision 0068, B9).
 */
export function createReadInboxMessage(deps: { history: ShipHistory; ships: Pick<ShipRepository, 'findOperatorShip'>; readReach: ReadReachOf; sealing: PayloadSealing }): ReadInboxMessage {
  return async (caller, { deliveryId }) => {
    const inbox = await inboxReadOf(deps, caller);
    const found = inbox ? await deps.history.inboxMessage(caller.fleetId, { shipId: inbox.shipId, deliveryId }) : undefined;
    if (!inbox || !found || !inbox.reads(found)) {
      return refuse('DELIVERY_NOT_FOUND', `No delivery ${deliveryId} in this inbox`);
    }
    return plainInboxEntry({ sealing: deps.sealing, fleetId: caller.fleetId }, found);
  };
}
