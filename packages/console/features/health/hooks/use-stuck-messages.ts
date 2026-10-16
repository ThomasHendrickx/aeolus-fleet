import { isPingContentType, type MessageId } from '@aeolus-fleet/common';
import { useQueries } from '@tanstack/react-query';

import { useTRPC } from '../../../lib/trpc';
import { previewOf } from '../services/health-view';
import type { DrilldownMessage } from '../ui/organisms/stuck-drilldown';

/**
 * The messages of a cause's stuck deliveries, read one by one through
 * `fleet.message`, by message id: what each row shows of its message. A
 * message still loading is absent, and its row waits.
 */
export function useStuckMessages(messageIds: readonly MessageId[]): { messages: ReadonlyMap<string, DrilldownMessage>; isLoading: boolean } {
  const trpc = useTRPC();
  const reads = useQueries({ queries: messageIds.map((messageId) => trpc.fleet.message.queryOptions({ messageId })) });
  const messages = new Map<string, DrilldownMessage>();
  for (const read of reads) {
    if (read.data) {
      messages.set(read.data.id, { preview: previewOf(read.data.payload), sender: read.data.sender, isPing: isPingContentType(read.data.contentType) });
    }
  }
  return { messages, isLoading: reads.some((read) => read.isPending) };
}
