import type { DeliveryId, DeliveryState, MessageId } from '@aeolus-fleet/common';

import type { ShipCaller } from './caller.js';
import { deliverySinceOf } from './delivery-way.js';
import { refuse, type DomainError } from './errors.js';
import type { HistoryParty, HistoryRecipient, ShipHistory } from './history.js';
import { ok, type Result } from './result.js';

/**
 * A message its sender sent, with where each delivery stands and since when,
 * and its ship: one delivery for a ship or a type, one per ship for a label
 * (decision 0065). No payload.
 */
export interface SentMessage {
  messageId: MessageId;
  sentAt: Date;
  recipient: HistoryRecipient;
  deliveries: { deliveryId: DeliveryId; ship: HistoryParty | null; state: DeliveryState; since: Date }[];
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
 * reader may see (decision 0034), and a label selection by its value ids as
 * sent, never their texts, which only fleet:read reads; each delivery names
 * its ship (R9 of decision 0065). No payload comes, not even its own. The
 * caller's scope (messages:send) is checked before this runs.
 */
export function createReadSentMessage(deps: { history: ShipHistory }): ReadSentMessage {
  return async (caller, { messageId }) => {
    const found = await deps.history.message(caller.fleetId, messageId);
    if (found?.sender.id !== caller.shipId) {
      return refuse('MESSAGE_NOT_FOUND', `No message ${messageId} in this fleet`);
    }
    return ok({
      messageId: found.id,
      sentAt: found.sentAt,
      recipient: found.recipient,
      deliveries: found.deliveries.map(({ id, ship, state, steps }) => ({ deliveryId: id, ship, state, since: deliverySinceOf(steps) })),
    });
  };
}
