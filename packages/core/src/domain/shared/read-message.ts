import type { MessageId } from '@aeolus-fleet/common';

import type { Caller } from './caller.js';
import { refuse, type DomainError } from './errors.js';
import { deliveryWayOf, type DeliveryWay } from './delivery-way.js';
import { readsMessage, type ReadReachOf } from '../registry/public.js';
import { partiesOf, type DeliveryChange, type HistoryMessage, type HistoryReply, type ShipHistory } from './history.js';
import { listedMessage } from './plain-history.js';
import { ok, type Result } from './result.js';
import type { ListedPayload, PayloadSealing } from '../messaging/public.js';

export type MessageDetail = Omit<HistoryMessage, 'payload'> & {
  /** Plain, or marked unreadable when its data key cannot be had (decision 0068, B9). */
  payload: ListedPayload;
  /** Its payload is stored sealed, for the console to mark it (N1). */
  isPayloadSealed: boolean;
  replies: HistoryReply[];
  delivery: HistoryMessage['delivery'] & { way: DeliveryWay; history: DeliveryChange[] };
  /** How many deliveries it has: one per ship for a label (decision 0065). */
  deliveryCount: number;
};

export type ReadMessage = (
  caller: Caller,
  input: { messageId: MessageId },
) => Promise<Result<MessageDetail, DomainError<'MESSAGE_NOT_FOUND'>>>;

/**
 * Use case: one message of the caller's fleet: its envelope, its whole
 * payload, its replies, and its delivery's way through: who holds it, since
 * when, the clocks that speak for it and every step newest first, from the
 * event log; and how many deliveries it has, one per ship for a label
 * (decision 0065). A message outside the caller's read reach is answered as none,
 * so its existence does not show (decision 0034). The caller's scope
 * (fleet:read) is checked before this runs. In a sealed fleet its payload is
 * unsealed; one whose data key cannot be had is marked unreadable and the
 * rest still answered, so the console shows the envelope and the delivery
 * (decision 0068, B9, scenario 25).
 */
export function createReadMessage(deps: { history: ShipHistory; readReach: ReadReachOf; sealing: PayloadSealing }): ReadMessage {
  return async (caller, { messageId }) => {
    const found = await deps.history.message(caller.fleetId, messageId);
    if (!found || !readsMessage(await deps.readReach(caller), partiesOf(found, found.delivery.claimedBy))) {
      return refuse('MESSAGE_NOT_FOUND', `No message ${messageId} in this fleet, or it is no longer kept`);
    }
    const { history, replies, lease, overdue, crew, ...message } = await listedMessage({ sealing: deps.sealing, fleetId: caller.fleetId }, found);
    const way = deliveryWayOf({ state: message.delivery.state, history, lease, overdue, crew });
    return ok({ ...message, replies, delivery: { ...message.delivery, way, history } });
  };
}
