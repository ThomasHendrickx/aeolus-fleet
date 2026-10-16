import type { MessageId, ShipId } from '@aeolus-fleet/common';

import type { MessageText } from './message-document';
import { messageTextOf } from './message-text';

/**
 * The thread a message to argo answers (#849): the messages it replies to,
 * one inReplyTo after another, oldest first, argo's own marked, read on the
 * web app's server. The blueprint's inbox promises "the thread to decide from".
 */

/** How far back a thread reads: enough to decide from, and a bound on the fleet calls. */
const THREAD_LIMIT = 10;

export interface ThreadSource {
  id: MessageId;
  sender: { id: ShipId; name: string };
  inReplyTo: MessageId | null;
  sentAt: string;
  contentType: string;
  payload: string;
}

export interface ThreadMessage {
  id: MessageId;
  sender: { id: ShipId; name: string };
  isArgo: boolean;
  sentAt: string;
  text: MessageText;
}

/** The thread from `from` (the message a message replies to) back, oldest first; it ends at a message it cannot read. */
export async function threadBefore(
  from: MessageId | null,
  { read, argoId }: { read: (messageId: MessageId) => Promise<ThreadSource | undefined>; argoId: ShipId },
): Promise<ThreadMessage[]> {
  const thread: ThreadMessage[] = [];
  let next = from;
  while (next !== null && thread.length < THREAD_LIMIT) {
    // One message after another: the next id is known only once this one is read.
    const message = await read(next);
    if (message === undefined) {
      break;
    }
    thread.push({ id: message.id, sender: message.sender, isArgo: message.sender.id === argoId, sentAt: message.sentAt, text: messageTextOf(message) });
    next = message.inReplyTo;
  }
  return thread.toReversed();
}
