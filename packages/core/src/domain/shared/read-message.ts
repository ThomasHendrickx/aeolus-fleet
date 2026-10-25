import type { DeliveryId, DeliveryState, MessageId } from '@aeolus-fleet/common';

import type { Caller } from './caller.js';
import { refuse, type DomainError } from './errors.js';
import { deliverySinceOf, deliveryWayOf, type DeliveryWay } from './delivery-way.js';
import { readsMessage, type ReadReachOf } from '../registry/public.js';
import { partiesOf, type DeliveryChange, type HistoryMessage, type HistoryParty, type HistoryReply, type ShipHistory } from './history.js';
import { ok, type Result } from './result.js';

export type MessageDetail = HistoryMessage & {
  replies: HistoryReply[];
  delivery: HistoryMessage['delivery'] & { way: DeliveryWay; history: DeliveryChange[] };
  /** Every delivery of it by id, with its ship, state and since when: one per ship for a label (decision 0065). */
  deliveries: { id: DeliveryId; ship: HistoryParty | null; state: DeliveryState; since: Date }[];
};

export type ReadMessage = (
  caller: Caller,
  input: { messageId: MessageId },
) => Promise<Result<MessageDetail, DomainError<'MESSAGE_NOT_FOUND'>>>;

/**
 * Use case: one message of the caller's fleet: its envelope, its whole
 * payload, its replies, and its delivery's way through: who holds it, since
 * when, the clocks that speak for it and every step newest first, from the
 * event log; and every delivery of it, one per ship for a label (decision
 * 0065), each with its ship and where it stands. A message outside the caller's read reach is answered as none,
 * so its existence does not show (decision 0034). The caller's scope
 * (fleet:read) is checked before this runs.
 */
export function createReadMessage(deps: { history: ShipHistory; readReach: ReadReachOf }): ReadMessage {
  return async (caller, { messageId }) => {
    const found = await deps.history.message(caller.fleetId, messageId);
    if (!found || !readsMessage(await deps.readReach(caller), partiesOf(found, found.delivery.claimedBy))) {
      return refuse('MESSAGE_NOT_FOUND', `No message ${messageId} in this fleet`);
    }
    const { history, replies, lease, overdue, crew, deliveries, ...message } = found;
    const way = deliveryWayOf({ state: message.delivery.state, history, lease, overdue, crew });
    return ok({
      ...message,
      replies,
      delivery: { ...message.delivery, way, history },
      deliveries: deliveries.map(({ id, ship, state, steps }) => ({ id, ship, state, since: deliverySinceOf(steps) })),
    });
  };
}
