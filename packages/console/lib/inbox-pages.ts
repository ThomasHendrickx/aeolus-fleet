import type { DeliveryId, InboxMessage } from '@aeolus-fleet/common';

import { inboxEntriesOf, type ListedShip } from './inbox-entries';
import type { InboxEntry } from './inbox-entry';
import type { PluginAnswer } from './plugin-answer';

/**
 * argo's inbox as the web app's server reads it page by page (decision 4 of
 * docs/design/performance/performance.md): the open messages whole, which
 * the navigation counts and the Open segment shows, and the rest a page at a
 * time. A question's withdrawal is newer than the question and stays open,
 * so laying a page out beside the open rows tells which of its questions
 * are stale; one argo marked done is not among them.
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

/** The messages of several reads, each delivery once, newest first. */
export function mergedInbox(...reads: readonly (readonly InboxMessage[])[]): InboxMessage[] {
  const byDelivery = new Map(reads.flat().map((message) => [message.deliveryId, message]));
  return [...byDelivery.values()].sort((first, second) => second.deliveryId.localeCompare(first.deliveryId));
}

/** A page's own entries, laid out beside the open rows. */
export function pageEntriesOf({ page, open, ships }: { page: readonly InboxMessage[]; open: readonly InboxMessage[]; ships: readonly ListedShip[] }): InboxEntry[] {
  const onPage = new Set(page.map(({ deliveryId }) => deliveryId));
  return inboxEntriesOf(mergedInbox(open, page), ships).filter(({ deliveryId }) => onPage.has(deliveryId));
}
