'use client';

import type { MessageId } from '@aeolus-fleet/common';

import { useConsoleRead } from '../../../lib/console-read-query';
import { fetchConsoleRead } from '../../../lib/fetch-console-read';
import { INBOX_KEY } from '../../../lib/inbox';
import type { ThreadMessage } from '../../../lib/inbox-thread';

/**
 * The thread an open message answers, read by the web app's server
 * (lib/inbox-reads.ts); undefined while it loads, for a message that answers
 * none, and when it could not be read. Under the inbox's key, so a live
 * change reloads it too.
 */
export function useThread(inReplyTo: MessageId | null | undefined): readonly ThreadMessage[] | undefined {
  const thread = useConsoleRead({
    queryKey: [...INBOX_KEY, 'thread', inReplyTo],
    queryFn: () => (inReplyTo === null || inReplyTo === undefined ? Promise.resolve([]) : fetchConsoleRead({ read: 'inbox-thread', input: { messageId: inReplyTo } })),
    enabled: inReplyTo !== null && inReplyTo !== undefined,
  });
  return thread.data;
}
