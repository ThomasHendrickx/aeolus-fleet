import type { ShipId } from '@aeolus-fleet/common';

import type { Recipient } from '../shared/selector.js';
import type { Delivery, Message } from './message.js';

/**
 * Whether a send answers the sender of a message its ship received, the
 * return traffic the network rules always allow (decision 0034): it names the
 * message (inReplyTo), it goes to that message's sender, and the message
 * reached the answering ship, by a delivery to it or one of its type it
 * claimed.
 */
export function isAnswerToSender(answer: { senderShipId: ShipId; recipient: Recipient }, asked: { message: Message; delivery: Delivery } | undefined): boolean {
  if (!asked || answer.recipient.kind !== 'ship' || answer.recipient.shipId !== asked.message.senderShipId) {
    return false;
  }
  const { delivery } = asked;
  const isToTheShip = delivery.recipient.kind === 'ship' && delivery.recipient.shipId === answer.senderShipId;
  return isToTheShip || delivery.claimedByShipId === answer.senderShipId;
}
