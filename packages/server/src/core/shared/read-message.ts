import type { MessageId } from '@aeolus-fleet/common';

import type { Caller } from './caller.js';
import { refuse, type DomainError } from './errors.js';
import type { DeliveryChange, HistoryMessage, ShipHistory } from './history.js';
import { ok, type Result } from './result.js';

export type MessageDetail = HistoryMessage & { delivery: HistoryMessage['delivery'] & { history: DeliveryChange[] } };

export type ReadMessage = (
  caller: Caller,
  input: { messageId: MessageId },
) => Promise<Result<MessageDetail, DomainError<'MESSAGE_NOT_FOUND'>>>;

/**
 * Use case: one message of the caller's fleet: its envelope, its whole
 * payload, and its delivery with every change newest first, from the event
 * log. The caller's scope (fleet:read) is checked before this runs.
 */
export function createReadMessage(deps: { history: ShipHistory }): ReadMessage {
  return async (caller, { messageId }) => {
    const found = await deps.history.message(caller.fleetId, messageId);
    if (!found) {
      return refuse('MESSAGE_NOT_FOUND', `No message ${messageId} in this fleet`);
    }
    const { history, ...message } = found;
    return ok({ ...message, delivery: { ...message.delivery, history } });
  };
}
