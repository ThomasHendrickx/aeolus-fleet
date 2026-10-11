import type { DeliveryHistoryEntry, DeliveryState, MessageRecipient } from '@aeolus-fleet/common';

import { locationKindWord } from '../../../lib/location';
import { ship, text, type SentencePart } from '../../../lib/sentence';

/** The StatusBadge each change of a delivery shows: the state it left the delivery in. */
export function deliveryHistoryState(entry: Pick<DeliveryHistoryEntry, 'type'>): DeliveryState {
  switch (entry.type) {
    case 'MessageAccepted':
    case 'DeliveryReturned':
      return 'pending';
    case 'DeliveryClaimed':
      return 'delivered';
    case 'DeliveryAcknowledged':
      return 'acknowledged';
    case 'DeliveryUndeliverable':
      return 'undeliverable';
    case 'DeliveryAbandoned':
      return 'abandoned';
    case 'DeliveryDismissed':
      return 'dismissed';
  }
}

/** ", session on hetzner-1": where the claiming session ran, its description when it gave one. */
function sessionOn(location: DeliveryHistoryEntry['location']): SentencePart[] {
  if (location === null) {
    return [];
  }
  const where =
    location.description !== null && location.description !== '' ? location.description : locationKindWord(location.kind);
  return [text(`, session on ${where}`)];
}

/** The ship the entry names, or nothing when it names none. */
function shipOf(entry: DeliveryHistoryEntry): SentencePart[] {
  return entry.ship ? [ship(entry.ship)] : [text('a ship')];
}

/**
 * The one sentence of a delivery change (docs/design/png/DeliveryHistory.png),
 * naming who held it. The recipient says whether the delivery waits in one
 * ship's inbox or in its type's queue.
 */
export function deliveryHistorySentence(entry: DeliveryHistoryEntry, recipient: MessageRecipient): SentencePart[] {
  switch (entry.type) {
    case 'MessageAccepted':
      return recipient.kind === 'ship'
        ? [text('Stored in the inbox of '), ship(recipient.ship), text('.')]
        : [text(`Queued for any ship of type ${recipient.type}.`)];
    case 'DeliveryClaimed': {
      const attempt = entry.attempts !== null && entry.attempts > 1 ? `Attempt ${String(entry.attempts)}: claimed` : 'Claimed';
      return [text(`${attempt} by `), ...shipOf(entry), ...sessionOn(entry.location), text('.')];
    }
    case 'DeliveryReturned':
      return recipient.kind === 'ship'
        ? [text('Back in the inbox: the session of '), ...shipOf(entry), text(' ended before acknowledging it.')]
        : [text('Returned to the queue: the session of '), ...shipOf(entry), text(' ended before acknowledging it.')];
    case 'DeliveryAcknowledged':
      return [text('Acknowledged by '), ...shipOf(entry), text('.')];
    case 'DeliveryUndeliverable':
      return [
        text(
          entry.attempts === null
            ? 'Never acknowledged: no ship takes it automatically any more.'
            : `Received ${String(entry.attempts)} times, never acknowledged.`,
        ),
      ];
    case 'DeliveryAbandoned':
      return [text('Abandoned: '), ...shipOf(entry), text(' was retired before taking it.')];
    case 'DeliveryDismissed':
      return [text('Dismissed by the operator: no ship takes it any more.')];
  }
}
