import type { DeliveryId, InboxMessage } from '@aeolus-fleet/common';

import type { PluginAnswer } from './plugin-answer';

/**
 * argo's inbox as the web app's server reads it page by page (decision 4 of
 * docs/design/performance/performance.md), newest first, until it holds the
 * rows it needs.
 */

/** A page of argo's inbox as `fleet.inbox` answers it. */
export interface InboxPage {
  items: InboxMessage[];
  nextCursor: DeliveryId | null;
}

/**
 * Reads pages newest first from the cursor until the rows read are enough or
 * the inbox ends: the rows, and where the next page starts.
 */
export async function readInboxPagesUntil(
  read: (cursor: DeliveryId | undefined) => Promise<PluginAnswer<InboxPage>>,
  query: { cursor?: DeliveryId; isEnough: (messages: readonly InboxMessage[]) => boolean },
): Promise<PluginAnswer<InboxPage>> {
  const items: InboxMessage[] = [];
  let cursor = query.cursor;
  for (;;) {
    const page = await read(cursor);
    if (page.kind !== 'answered') {
      return page;
    }
    items.push(...page.data.items);
    if (page.data.nextCursor === null || query.isEnough(items)) {
      return { kind: 'answered', data: { items, nextCursor: page.data.nextCursor } };
    }
    cursor = page.data.nextCursor;
  }
}
