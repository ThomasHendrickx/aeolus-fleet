import type { MessageId } from '@aeolus-fleet/common';

import type { Caller } from './caller.js';
import { refuse, type DomainError } from './errors.js';
import { deliveryWayOf, type DeliveryWay } from './delivery-way.js';
import type { DeliveryChange, HistoryMessage, HistoryReply, ShipHistory } from './history.js';
import { ok, type Result } from './result.js';

export type MessageDetail = HistoryMessage & {
  replies: HistoryReply[];
  delivery: HistoryMessage['delivery'] & { way: DeliveryWay; history: DeliveryChange[] };
};

export type ReadMessage = (
  caller: Caller,
  input: { messageId: MessageId },
) => Promise<Result<MessageDetail, DomainError<'MESSAGE_NOT_FOUND'>>>;

/**
 * Use case: one message of the caller's fleet: its envelope, its whole
 * payload, its replies, and its delivery's way through: who holds it, since
 * when, the clocks that speak for it and every step newest first, from the
 * event log. The caller's scope (fleet:read) is checked before this runs.
 */
export function createReadMessage(deps: { history: ShipHistory }): ReadMessage {
  return async (caller, { messageId }) => {
    const found = await deps.history.message(caller.fleetId, messageId);
    if (!found) {
      return refuse('MESSAGE_NOT_FOUND', `No message ${messageId} in this fleet`);
    }
    const { history, replies, lease, overdue, crew, ...message } = found;
    const way = deliveryWayOf({ state: message.delivery.state, history, lease, overdue, crew });
    return ok({ ...message, replies, delivery: { ...message.delivery, way, history } });
  };
}
