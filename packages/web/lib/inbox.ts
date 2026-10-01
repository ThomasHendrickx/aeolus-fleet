import type { DeliveryId, InboxFilter, InboxMessage } from '@aeolus-fleet/common';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useTRPC } from './trpc';

/**
 * argo's inbox, every message to it: one live query, which the page filters
 * and the navigation counts, so a change reloads it once.
 */
export function useInbox() {
  const trpc = useTRPC();
  return useQuery(trpc.fleet.inbox.queryOptions({ filter: 'all' }));
}

/** How many messages to argo are open, for the navigation; undefined until known. */
export function useOpenInboxCount(): number | undefined {
  const messages = useInbox().data;
  return messages === undefined ? undefined : isOpenCount(messages);
}

function isOpen(message: Pick<InboxMessage, 'state'>): boolean {
  return message.state === 'pending' || message.state === 'delivered';
}

function isOpenCount(messages: readonly Pick<InboxMessage, 'state'>[]): number {
  return messages.filter(isOpen).length;
}

/** The messages a filter keeps, in the server's order: open is not done yet, done is acknowledged. */
export function messagesFor<T extends Pick<InboxMessage, 'state'>>(messages: readonly T[], filter: InboxFilter): T[] {
  switch (filter) {
    case 'open':
      return messages.filter(isOpen);
    case 'done':
      return messages.filter((message) => message.state === 'acknowledged');
    case 'all':
      return [...messages];
  }
}

/** The count beside each filter. */
export function filterCounts(messages: readonly Pick<InboxMessage, 'state'>[]): Record<InboxFilter, number> {
  return {
    open: messagesFor(messages, 'open').length,
    done: messagesFor(messages, 'done').length,
    all: messages.length,
  };
}

/** The inbox filter in the URL; Open unless it says otherwise. */
export function readInboxFilter(value: string | undefined): InboxFilter {
  return value === 'done' || value === 'all' ? value : 'open';
}

/** The inbox page's path for a filter and an open message. */
export function inboxPathOf(view: { filter: InboxFilter; deliveryId?: DeliveryId }): string {
  const params = new URLSearchParams();
  if (view.filter !== 'open') {
    params.set('filter', view.filter);
  }
  if (view.deliveryId !== undefined) {
    params.set('message', view.deliveryId);
  }
  const query = params.toString();
  return query === '' ? '/inbox' : `/inbox?${query}`;
}

/** Refreshes the inbox, and every ship page read, after an inbox action. */
function useRefreshFleet(): () => Promise<void> {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: trpc.fleet.pathKey() });
}

/** Marks a message to argo read or unread. */
export function useMarkRead() {
  const trpc = useTRPC();
  const refresh = useRefreshFleet();
  return useMutation(trpc.fleet.markRead.mutationOptions({ onSuccess: refresh }));
}

/** Marks a message to argo done. */
export function useMarkDone() {
  const trpc = useTRPC();
  const refresh = useRefreshFleet();
  return useMutation(trpc.fleet.markDone.mutationOptions({ onSuccess: refresh }));
}

/** Replies to a message to argo, which also marks it done. */
export function useReply() {
  const trpc = useTRPC();
  const refresh = useRefreshFleet();
  return useMutation(trpc.fleet.reply.mutationOptions({ onSuccess: refresh }));
}
