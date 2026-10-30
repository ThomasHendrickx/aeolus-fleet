import { PAGE_SIZE_DEFAULT, type DeliveryId, type DeliveryState, type MessageId } from '@aeolus-fleet/common';

import type { Caller } from './caller.js';
import { deliverySinceOf } from './delivery-way.js';
import { refuse, type DomainError } from './errors.js';
import { isSameTask, readsShip, readsMessage, type ShipReport, type ReadReachOf } from '../registry/public.js';
import { partiesOf, type HistoryParty, type ShipHistory } from './history.js';
import type { Page } from './page.js';
import { ok, type Result } from './result.js';

/** One delivery of a message: the ship it went to or that claimed it (null while none has), its state and since when. */
export interface ListedDelivery {
  id: DeliveryId;
  ship: HistoryParty | null;
  state: DeliveryState;
  since: Date;
  progress: Pick<ShipReport, 'state' | 'note' | 'step' | 'reportChangedAt'> | null;
}

export type ReadMessageDeliveries = (
  caller: Caller,
  input: { messageId: MessageId; cursor?: DeliveryId; limit?: number },
) => Promise<Result<Page<ListedDelivery, DeliveryId>, DomainError<'MESSAGE_NOT_FOUND'>>>;

/**
 * Use case: a page of the deliveries of one message of the caller's fleet, by
 * id, each with its ship and where it stands: one for a ship or a type, one
 * per ship for a label (decision 0065). A message outside the caller's read
 * reach is answered as none, as reading the message is (decision 0034). The
 * caller's scope (fleet:read) is checked before this runs.
 */
export function createReadMessageDeliveries(deps: { history: ShipHistory; readReach: ReadReachOf }): ReadMessageDeliveries {
  return async (caller, { messageId, cursor, limit = PAGE_SIZE_DEFAULT }) => {
    const found = await deps.history.message(caller.fleetId, messageId);
    const reach = await deps.readReach(caller);
    if (!found || !readsMessage(reach, partiesOf(found, found.delivery.claimedBy))) {
      return refuse('MESSAGE_NOT_FOUND', `No message ${messageId} in this fleet`);
    }
    const page = await deps.history.messageDeliveries(caller.fleetId, { messageId, cursor, limit });
    return ok({ items: page.items.map(({ id, ship, state, steps, report }) => ({ id, ship, state, since: deliverySinceOf(steps), progress: ship && readsShip(reach, ship.id) && report && isSameTask(report.task, { kind: 'message', fleetId: caller.fleetId, messageId }) ? { state: report.state, note: report.note, step: report.step, reportChangedAt: report.reportChangedAt } : null })), nextCursor: page.nextCursor });
  };
}
