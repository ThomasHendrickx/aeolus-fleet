import { isPingContentType, type DeliveryState, type MessageId, type ShipId } from '@aeolus-fleet/common';

import type { Message } from './message.js';

/**
 * An exchange (docs/design/exchange-read, E1): what one ship and one other
 * ship said to each other, every message one of them sent that reached the
 * other, by name, by type once the other claimed it, or by label. A meeting's
 * messages are the meeting's (decision 0061), and a ping is a check of the
 * ship, not something said, so neither is in an exchange.
 */
export function isInExchange(message: Pick<Message, 'meetingId' | 'contentType'>): boolean {
  return message.meetingId === null && !isPingContentType(message.contentType);
}

/** A delivery as its exchange counts it: its message and sender, the ship it reached, if any yet, and its state. */
export interface ExchangeSide {
  messageId: MessageId;
  senderShipId: ShipId;
  reachedShipId: ShipId | null;
  state: DeliveryState;
}

/** What one delivery's change adds to one ship's row for another ship: the newest message, and how many more are not yet acknowledged. */
export interface ExchangeCount {
  shipId: ShipId;
  otherShipId: ShipId;
  newestMessageId: MessageId;
  unacknowledged: number;
}

/** Not yet acknowledged: pending, received or handed, whatever its content type (E5). */
function isUnacknowledged(state: DeliveryState): boolean {
  return state === 'pending' || state === 'received' || state === 'handed';
}

/**
 * What a delivery's change from `before` to `after` (none before when it is
 * made) adds to the rows of its exchange (E4, E5): the row of the ship it
 * reached for its sender counts it while it is not yet acknowledged; once it
 * reaches a ship, both rows know its message as their newest unless a newer
 * one is. A change that adds nothing answers nothing.
 */
export function exchangeCountsOf(change: { before?: ExchangeSide; after?: ExchangeSide }): ExchangeCount[] {
  const { before, after } = change;
  const counts = new Map<string, ExchangeCount>();
  const add = (count: ExchangeCount) => {
    const key = `${count.shipId} ${count.otherShipId}`;
    const sum = counts.get(key);
    counts.set(key, { ...count, unacknowledged: (sum?.unacknowledged ?? 0) + count.unacknowledged });
  };
  const isNewReach = after?.reachedShipId != null && after.reachedShipId !== before?.reachedShipId;
  if (before?.reachedShipId != null && isUnacknowledged(before.state)) {
    add({ shipId: before.reachedShipId, otherShipId: before.senderShipId, newestMessageId: before.messageId, unacknowledged: -1 });
  }
  if (after?.reachedShipId != null) {
    const reached = { shipId: after.reachedShipId, otherShipId: after.senderShipId, newestMessageId: after.messageId };
    add({ ...reached, unacknowledged: isUnacknowledged(after.state) ? 1 : 0 });
    if (isNewReach) {
      add({ shipId: after.senderShipId, otherShipId: after.reachedShipId, newestMessageId: after.messageId, unacknowledged: 0 });
    }
  }
  return [...counts.values()].filter((count) => count.unacknowledged !== 0 || isNewReach);
}
