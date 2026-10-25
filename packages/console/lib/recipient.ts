import type { MessageRecipient } from '@aeolus-fleet/common';

type LabelSelection = Extract<MessageRecipient, { kind: 'label' }>['values'];

/** A label selection as key=value texts joined by "and"; a value its label no longer has by its id. */
export function labelSelectionWords(values: LabelSelection): string {
  return values.map(({ valueId, key, value }) => (key === null || value === null ? valueId : `${key}=${value}`)).join(' and ');
}

/**
 * A recipient that is no one ship, in words: the ships of a type, a meeting's
 * other participants (decision 0061), or the ships of a label selection
 * (decision 0065), each value by its key and value.
 */
export function recipientGroupWords(recipient: Exclude<MessageRecipient, { kind: 'ship' }>): string {
  switch (recipient.kind) {
    case 'type':
      return `any ship of type ${recipient.type}`;
    case 'meeting':
      return `every other participant of meeting ${recipient.meetingId}`;
    case 'label':
      return `every ship carrying ${labelSelectionWords(recipient.values)}`;
  }
}
