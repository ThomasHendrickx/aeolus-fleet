import type { DeliveryId, DeliveryState, InboxQuestion, MessageId, ShipId } from '@aeolus-fleet/common';

import type { MessageText } from './message-document';
import type { Staleness } from './questions';

/**
 * One entry of argo's inbox as the web app's server reads it (#849, decisions
 * 0033 and 0038): a question with its answer and staleness, or a message laid
 * out for reading. Withdrawals that made a question stale are left out. The
 * browser imports only these types, and what is open.
 */

export interface InboxSender {
  id: ShipId;
  name: string;
  /** The sender's type; null when the fleet no longer lists it. */
  type: string | null;
  /** Whether another ship of the fleet, retired ones included, has the same name: the message header then adds the id suffix. */
  isNameShared: boolean;
}

interface EntryBase {
  deliveryId: DeliveryId;
  messageId: MessageId;
  state: DeliveryState;
  readAt: string | null;
  doneAt: string | null;
  sender: InboxSender;
  sentAt: string;
  model: string | null;
}

export interface QuestionEntry extends EntryBase {
  kind: 'question';
  question: InboxQuestion;
  stale: Staleness | null;
  replaces: { deliveryId: DeliveryId; title: string } | null;
}

export interface MessageEntry extends EntryBase {
  kind: 'message';
  /** Sent by a plugin's ship (a trierarch, squadrons, the trierarch or networking plugin): folded into one row. */
  isFromPlugin: boolean;
  repliedWith: MessageId | null;
  inReplyTo: MessageId | null;
  text: MessageText;
  /** argo's replies to it, oldest first. */
  replies: { id: MessageId; sentAt: string; text: MessageText }[];
}

export type InboxEntry = QuestionEntry | MessageEntry;

/**
 * What waits on the operator: a question until it is answered or stale,
 * whatever its delivery's state (decision 0038); a message until it is done.
 */
export function isOpenEntry(entry: InboxEntry): boolean {
  return entry.kind === 'question' ? entry.question.answer === null && entry.stale === null : entry.state !== 'acknowledged';
}
