import type { ListedMessage, MessageId } from '@aeolus-fleet/common';

/** Messages that answer each other, oldest first, and when the last one was sent. */
export interface MessageThread {
  /** The id of the thread's first message on the page. */
  id: MessageId;
  messages: ListedMessage[];
  lastSentAt: string;
}

/** The first message of the thread the message is in, among the messages on the page. */
function rootOf(message: ListedMessage, byId: ReadonlyMap<MessageId, ListedMessage>): ListedMessage {
  const seen = new Set<MessageId>([message.id]);
  let current = message;
  let parent = current.inReplyTo === null ? undefined : byId.get(current.inReplyTo);
  // A cycle cannot be sent (a reply names an earlier message), but the walk stops on one anyway.
  while (parent && !seen.has(parent.id)) {
    seen.add(parent.id);
    current = parent;
    parent = current.inReplyTo === null ? undefined : byId.get(current.inReplyTo);
  }
  return current;
}

function byTime(first: ListedMessage, second: ListedMessage): number {
  return first.sentAt.localeCompare(second.sentAt) || first.id.localeCompare(second.id);
}

/**
 * Groups a ship's messages into threads by inReplyTo: a reply to a message on
 * the page joins that message's thread; a reply to one that is not starts its
 * own. Threads with the latest message first, messages in a thread oldest first.
 */
export function threadsOf(messages: readonly ListedMessage[]): MessageThread[] {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const threads = new Map<MessageId, ListedMessage[]>();
  for (const message of messages) {
    const root = rootOf(message, byId);
    threads.set(root.id, [...(threads.get(root.id) ?? []), message]);
  }
  return [...threads.entries()]
    .map(([id, inThread]) => {
      const ordered = inThread.toSorted(byTime);
      return { id, messages: ordered, lastSentAt: ordered.at(-1)?.sentAt ?? '' };
    })
    .toSorted((first, second) => second.lastSentAt.localeCompare(first.lastSentAt) || second.id.localeCompare(first.id));
}
