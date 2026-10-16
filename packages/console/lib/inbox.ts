'use client';

import type { AnswerChoice, DeliveryId, InboxFilter } from '@aeolus-fleet/common';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useConsoleRead } from './console-read-query';
import { fetchConsoleRead } from './fetch-console-read';
import { isOpenEntry } from './inbox-entry';
import { dataOf } from './plugin-answer';
import { answerQuestion } from './questions-actions';
import { useTRPC } from './trpc';

/**
 * argo's one inbox as the browser reads it (#849): the questions and messages
 * the web app's server laid out (lib/inbox-reads.ts), one live read that the
 * page shows and the navigation counts, and what acts on them.
 */

/** The inbox read's key, which a live message change reloads (lib/live-fleet.ts). */
export const INBOX_KEY = ['inbox'];

/** Every question and message to argo, as the web app's server laid them out. */
export function useInboxEntries() {
  return useConsoleRead({ queryKey: INBOX_KEY, queryFn: () => fetchConsoleRead({ read: 'inbox' }) });
}

/** What waits on the operator, open questions and open messages together, for the navigation; undefined until known. */
export function useOpenInboxCount(): number | undefined {
  return useInboxEntries().data?.filter(isOpenEntry).length;
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
