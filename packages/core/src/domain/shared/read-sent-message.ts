import type { DeliveryId, DeliveryState, MessageId } from '@aeolus-fleet/common';

import type { ShipCaller } from './caller.js';
import { deliveryWayOf } from './delivery-way.js';
import { refuse, type DomainError } from './errors.js';
import type { HistoryRecipient, ShipHistory } from './history.js';
import { ok, type Result } from './result.js';

/** A message its sender sent, with where its delivery stands and since when. No payload. */
export interface SentMessage {
  messageId: MessageId;
  sentAt: Date;
  recipient: HistoryRecipient;
  delivery: { deliveryId: DeliveryId; state: DeliveryState; since: Date };
}

export type ReadSentMessage = (
  caller: ShipCaller,
  input: { messageId: MessageId },
) => Promise<Result<SentMessage, DomainError<'MESSAGE_NOT_FOUND'>>>;

/**
 * Use case: a sender reads where the delivery of a message it sent stands
 * (`sentMessage`, interop 3.5), so a gateway tells submitted from working
 * and failed without fleet:read, which reads every payload. Its own message
 * only: one another ship sent is answered as none, argo's reads included, so
 * its existence does not show. Its recipient comes by name or type, which any
 * reader may see (decision 0034); no payload comes, not even its own. The
 * caller's scope (messages:send) is checked before this runs.
 */
export function createReadSentMessage(deps: { history: ShipHistory }): ReadSentMessage {
  return async (caller, { messageId }) => {
    const found = await deps.history.message(caller.fleetId, messageId);
    if (found?.sender.id !== caller.shipId) {
      return refuse('MESSAGE_NOT_FOUND', `No message ${messageId} in this fleet`);
    }
    const { since } = deliveryWayOf({ state: found.delivery.state, history: found.history, lease: found.lease, overdue: found.overdue, crew: found.crew });
    return ok({
      messageId: found.id,
      sentAt: found.sentAt,
      recipient: found.recipient,
      delivery: { deliveryId: found.delivery.id, state: found.delivery.state, since },
    });
  };
}
