'use client';

import type { DeliveryId, InboxFilter } from '@aeolus-fleet/common';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { showToast } from '../../../components/atoms/toast';
import { OperatorInbox } from '../../../features/inbox/organisms/operator-inbox';
import { ListPage } from '../../../components/organisms/list-page';
import { useConsoleFrame } from '../../../lib/console-frame';
import {
  filterCounts,
  inboxPathOf,
  messagesFor,
  readInboxFilter,
  useInbox,
  useMarkDone,
  useMarkRead,
  useReply,
} from '../../../lib/inbox';
import { useAccess } from '../../../lib/access';
import { useLiveFleet } from '../../../lib/live-fleet';
import { useNow } from '../../../lib/now';
import { useSignInWhenSessionEnds } from '../../../lib/session';

/** The refusal's words, safe to show: the server's message. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Try again in a moment.';
}

/**
 * argo's inbox, live: the messages ships sent to the operator, Open, Done or
 * All. Opening one marks it read; Mark done or Reply acknowledges it. The
 * filter and the open message live in the URL, read on the web app's server
 * (page.tsx).
 */
export function InboxPageFor({ filterParameter, selectedId }: { filterParameter?: string; selectedId?: DeliveryId }) {
  const router = useRouter();
  const now = useNow();
  const filter = readInboxFilter(filterParameter);

  const inbox = useInbox();
  const markRead = useMarkRead();
  const markDone = useMarkDone();
  const reply = useReply();
  const liveFleet = useLiveFleet();
  const frame = useConsoleFrame();
  useSignInWhenSessionEnds([inbox.error, liveFleet.error]);
  const access = useAccess();
  const [pendingIds, setPendingIds] = useState<ReadonlySet<DeliveryId>>(new Set());

  const all = inbox.data ?? [];
  const show = (view: { filter: InboxFilter; deliveryId?: DeliveryId }) => {
    router.replace(inboxPathOf(view), { scroll: false });
  };
  const act = ({ deliveryId, run, failure }: { deliveryId: DeliveryId; run: () => Promise<unknown>; failure: string }) => {
    setPendingIds((pending) => new Set([...pending, deliveryId]));
    run()
      .catch((error: unknown) => {
        showToast({ title: failure, description: messageOf(error), tone: 'error' });
      })
      .finally(() => {
        setPendingIds((pending) => new Set([...pending].filter((id) => id !== deliveryId)));
      });
  };

  return (
    <ListPage
      {...frame}
      title="Operator inbox"
      description="Messages ships sent to argo. Opening one marks it read; Mark done or Reply acknowledges it."
      live={liveFleet.live}
    >
      <OperatorInbox
        isReadOnly={!access.canReceive}
        messages={messagesFor(all, filter)}
        filter={filter}
        onFilterChange={(next) => {
          show({ filter: next });
        }}
        counts={inbox.data ? filterCounts(all) : {}}
        selectedId={selectedId}
        onSelect={(deliveryId) => {
          show({ filter, deliveryId });
          const chosen = all.find((message) => message.deliveryId === deliveryId);
          // A read-only session (a viewer's) marks nothing read: opening a message changes nothing.
          if (deliveryId !== undefined && chosen?.readAt === null && access.canReceive) {
            markRead.mutate({ deliveryId, isRead: true });
          }
        }}
        state={inbox.isError ? 'error' : inbox.data ? 'ready' : 'loading'}
        onRetry={() => {
          void inbox.refetch();
        }}
        onMarkDone={(deliveryId) => {
          act({ deliveryId, run: () => markDone.mutateAsync({ deliveryId }), failure: "Couldn’t mark the message done" });
        }}
        onMarkUnread={(deliveryId) => {
          act({
            deliveryId,
            run: () => markRead.mutateAsync({ deliveryId, isRead: false }),
            failure: "Couldn’t mark the message unread",
          });
          show({ filter });
        }}
        onReply={({ deliveryId, payload }) => {
          act({
            deliveryId,
            run: () => reply.mutateAsync({ deliveryId, payload, idempotencyKey: `reply-${deliveryId}-${crypto.randomUUID()}` }),
            failure: "Couldn’t send the reply",
          });
        }}
        pendingIds={pendingIds}
        now={now}
      />
    </ListPage>
  );
}
