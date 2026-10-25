import { PAGE_SIZE_MAX, type DeliveryId, type DeliveryState, type LabelValueId, type MessageId } from '@aeolus-fleet/common';

import type { ShipCaller } from './caller.js';
import { deliverySinceOf } from './delivery-way.js';
import { refuse, type DomainError } from './errors.js';
import type { HistoryParty, HistoryRecipient, MessageDelivery, ShipHistory } from './history.js';
import { ok, type Result } from './result.js';

/**
 * A message its sender sent, with where each delivery stands and since when,
 * and its ship: one delivery for a ship or a type, one per ship for a label
 * (decision 0065). No payload.
 */
export interface SentMessage {
  messageId: MessageId;
  sentAt: Date;
  recipient: SentRecipient;
  deliveries: { deliveryId: DeliveryId; ship: HistoryParty | null; state: DeliveryState; since: Date }[];
}

/** Who the message was addressed to, a label selection by its value ids as sent. */
export type SentRecipient = Exclude<HistoryRecipient, { kind: 'label' }> | { kind: 'label'; valueIds: readonly LabelValueId[] };

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
  /** Every delivery of the message, read a page at a time in the database: its answer holds them all. */
  const deliveriesOf = async (fleetId: ShipCaller['fleetId'], messageId: MessageId): Promise<MessageDelivery[]> => {
    const deliveries: MessageDelivery[] = [];
    let cursor: DeliveryId | undefined;
    do {
      const page = await deps.history.messageDeliveries(fleetId, { messageId, cursor, limit: PAGE_SIZE_MAX });
      deliveries.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    return deliveries;
  };

  return async (caller, { messageId }) => {
    const found = await deps.history.message(caller.fleetId, messageId);
    if (found?.sender.id !== caller.shipId) {
      return refuse('MESSAGE_NOT_FOUND', `No message ${messageId} in this fleet`);
    }
    return ok({
      messageId: found.id,
      sentAt: found.sentAt,
      recipient: found.recipient.kind === 'label' ? { kind: 'label', valueIds: found.recipient.values.map(({ valueId }) => valueId) } : found.recipient,
      deliveries: (await deliveriesOf(caller.fleetId, messageId)).map(({ id, ship, state, steps }) => ({ deliveryId: id, ship, state, since: deliverySinceOf(steps) })),
    });
  };
}
