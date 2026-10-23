'use client';

import type { AnswerChoice, DeliveryId, InboxFilter } from '@aeolus-fleet/common';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useSignInWhenSessionEnds } from './session';
import { fetchConsoleRead } from './fetch-console-read';
import { CONSOLE_PAGE_SIZE, pagedListOf } from './paged-list';
import { dataOf } from './plugin-answer';
import { answerQuestion } from './questions-actions';
import { useTRPC } from './trpc';

/**
 * argo's one inbox as the browser reads it (#849): the questions and messages
 * the web app's server laid out (lib/inbox-reads.ts), read live as far as
 * the page shows them, the count of the open ones core answers for the
 * navigation, and what acts on them.
 */

/** The inbox read's key, which a live message change reloads (lib/live-fleet.ts). */
export const INBOX_KEY = ['inbox'];

/**
 * The newest questions and messages to argo the segment keeps, as the web app's
 * server laid them out, and 20 more each time the operator asks.
 */
export function useInboxEntries(filter: InboxFilter) {
  const query = useInfiniteQuery({
    queryKey: [...INBOX_KEY, filter],
    queryFn: async ({ pageParam: size }) => ({ ...(await fetchConsoleRead({ read: 'inbox', input: { filter, size } })), size }),
    initialPageParam: CONSOLE_PAGE_SIZE,
    getNextPageParam: (shown) => (shown.hasMore ? shown.size + CONSOLE_PAGE_SIZE : undefined),
    // Each read lays out every row shown, the newer ones too, so a question folds with its withdrawals; only the last is kept, and a reload reads only it.
    maxPages: 1,
  });
  useSignInWhenSessionEnds([query.error]);
  return pagedListOf(query);
}

/** What waits on the operator, open questions and open messages together, as core counts them, for the navigation and Open; undefined until known. */
export function useOpenInboxCount(): number | undefined {
  const trpc = useTRPC();
  const count = useQuery(trpc.fleet.inboxCount.queryOptions());
  useSignInWhenSessionEnds([count.error]);
  return count.data?.open;
}

/** The inbox segment in the URL; Open unless it says otherwise. */
export function readInboxFilter(value: string | undefined): InboxFilter {
  return value === 'done' || value === 'all' ? value : 'open';
}

/** The inbox page's path for a segment and an open question or message. */
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
function useRefreshInbox(): () => Promise<void> {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([queryClient.invalidateQueries({ queryKey: INBOX_KEY }), queryClient.invalidateQueries({ queryKey: trpc.fleet.pathKey() })]);
  };
}

/** Marks a message to argo read or unread. */
export function useMarkRead() {
  const trpc = useTRPC();
  const refresh = useRefreshInbox();
  return useMutation(trpc.fleet.markRead.mutationOptions({ onSuccess: refresh }));
}

/** Marks a message to argo done. */
export function useMarkDone() {
  const trpc = useTRPC();
  const refresh = useRefreshInbox();
  return useMutation(trpc.fleet.markDone.mutationOptions({ onSuccess: refresh }));
}

/** Replies to a message to argo, which also marks it done. */
export function useReply() {
  const trpc = useTRPC();
  const refresh = useRefreshInbox();
  return useMutation(trpc.fleet.reply.mutationOptions({ onSuccess: refresh }));
}

/** Answers a question to argo, which also marks its message done. */
export function useAnswer() {
  const refresh = useRefreshInbox();
  return useMutation({
    mutationFn: async (input: { deliveryId: DeliveryId; answer: AnswerChoice; idempotencyKey: string }) => dataOf(await answerQuestion(input)),
    onSuccess: refresh,
  });
}
