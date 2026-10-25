import type { MessageRecipient } from '@aeolus-fleet/common';

/**
 * A recipient that is no one ship, in words: the ships of a type, a meeting's
 * other participants (decision 0061), or the ships of a label selection
 * (decision 0065), named by their texts once reads carry them.
 */
export function recipientGroupWords(recipient: Exclude<MessageRecipient, { kind: 'ship' }>): string {
  switch (recipient.kind) {
    case 'type':
      return `any ship of type ${recipient.type}`;
    case 'meeting':
      return `every other participant of meeting ${recipient.meetingId}`;
    case 'label':
      return `every ship carrying ${recipient.valueIds.join(' and ')}`;
  }
}
