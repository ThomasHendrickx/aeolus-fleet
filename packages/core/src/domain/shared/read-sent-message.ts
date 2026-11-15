import { PAGE_SIZE_DEFAULT, type DeliveryId, type DeliveryState, type LabelValueId, type MessageId } from '@aeolus-fleet/common';

import type { ShipCaller } from './caller.js';
import { deliverySinceOf } from './delivery-way.js';
import { refuse, type DomainError } from './errors.js';
import type { HistoryParty, HistoryRecipient, ShipHistory } from './history.js';
import { ok, type Result } from './result.js';

/**
 * A message its sender sent, with a page of where its deliveries stand and since when,
 * and its ship: one delivery for a ship or a type, one per ship for a label
 * (decision 0065). No payload.
 */
export interface SentMessage {
  messageId: MessageId;
  sentAt: Date;
  recipient: SentRecipient;
  items: { id: DeliveryId; ship: HistoryParty | null; state: DeliveryState; since: Date }[];
  nextCursor: DeliveryId | null;
}

/** Who the message was addressed to, a label selection by its value ids as sent. */
export type SentRecipient = Exclude<HistoryRecipient, { kind: 'label' }> | { kind: 'label'; valueIds: readonly LabelValueId[] };

export type ReadSentMessage = (
  caller: ShipCaller,
  input: { messageId: MessageId; cursor?: DeliveryId; limit?: number },
) => Promise<Result<SentMessage, DomainError<'MESSAGE_NOT_FOUND'>>>;

/**
 * Use case: a sender reads where the delivery of a message it sent stands
 * (`sentMessage`, interop 3.5), so a gateway tells submitted from working
 * and failed without fleet:read, which reads every payload. Its own message
 * only: one another ship sent is answered as none, argo's reads included, so
 * its existence does not show. Its recipient comes by name or type, which any
 * reader may see (decision 0034), and a label selection by its value ids as
 * sent, never their texts, which only fleet:read reads; each delivery names
 * its ship (R9 of decision 0065), a page at a time by delivery id. No payload comes, not even its own. The
 * caller's scope (messages:send) is checked before this runs.
 */
export function createReadSentMessage(deps: { history: ShipHistory }): ReadSentMessage {
  return async (caller, { messageId, cursor, limit = PAGE_SIZE_DEFAULT }) => {
    const found = await deps.history.message(caller.fleetId, messageId);
    if (found?.sender.id !== caller.shipId) {
      return refuse('MESSAGE_NOT_FOUND', `No message ${messageId} in this fleet, or it is no longer kept`);
    }
    const page = await deps.history.messageDeliveries(caller.fleetId, { messageId, cursor, limit });
    return ok({
      messageId: found.id,
      sentAt: found.sentAt,
      recipient: found.recipient.kind === 'label' ? { kind: 'label', valueIds: found.recipient.values.map(({ valueId }) => valueId) } : found.recipient,
      items: page.items.map(({ id, ship, state, steps }) => ({ id, ship, state, since: deliverySinceOf(steps) })),
      nextCursor: page.nextCursor,
    });
  };
}
