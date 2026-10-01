'use client';

import { idSchema, type DeliveryId, type InboxFilter } from '@aeolus-fleet/common';
import { useRouter } from 'next/navigation';
import { use, useState } from 'react';

import { showToast } from '../../components/atoms/toast';
import { ComposeMessage } from '../../components/organisms/compose-message';
import { OperatorInbox } from '../../components/organisms/operator-inbox';
import { ListLayout } from '../../components/templates/list-layout';
import {
  filterCounts,
  inboxPathOf,
  messagesFor,
  readInboxFilter,
  useInbox,
  useMarkDone,
  useMarkRead,
  useReply,
} from '../../lib/inbox';
import { useLiveFleet } from '../../lib/live-fleet';
import { useAttentionCount } from '../../lib/needs-attention';
import { useNow } from '../../lib/now';
import { useAccountMenu } from '../../lib/account';
import { useSignInWhenSessionEnds } from '../../lib/session';

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The refusal's words, safe to show: the server's message. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Try again in a moment.';
}

/**
 * argo's inbox, live: the messages ships sent to the operator, Open, Done or
 * All. Opening one marks it read; Mark done or Reply acknowledges it. The
 * filter and the open message live in the URL.
 */
export default function InboxPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const router = useRouter();
  const now = useNow();
  const query = use(searchParams);
  const filter = readInboxFilter(first(query.filter));
  const opened = idSchema('delivery').safeParse(first(query.message));
  const selectedId = opened.success ? opened.data : undefined;

  const inbox = useInbox();
  const markRead = useMarkRead();
  const markDone = useMarkDone();
  const reply = useReply();
  const attentionCount = useAttentionCount();
  const liveFleet = useLiveFleet();
  const accountMenu = useAccountMenu(now);
  useSignInWhenSessionEnds([inbox.error, liveFleet.error]);
  const [isComposing, setIsComposing] = useState(false);
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
    <ListLayout
      title="Operator inbox"
      description="Messages ships sent to argo. Opening one marks it read; Mark done or Reply acknowledges it."
      live={liveFleet.live}
      nav={{ active: 'inbox', inboxCount: filterCounts(all).open, attentionCount }}
      account={accountMenu}
      onCompose={() => {
        setIsComposing(true);
      }}
    >
      <OperatorInbox
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
          if (deliveryId !== undefined && chosen?.readAt === null) {
            markRead.mutate({ deliveryId, isRead: true });
          }
        }}
        state={inbox.isError ? 'error' : inbox.data ? 'ready' : 'loading'}
        onRetry={() => {
          void inbox.refetch();
        }}
        onMarkDone={(deliveryId) => {
          act({ deliveryId, run: () => markDone.mutateAsync({ deliveryId }), failure: "Couldn't mark the message done" });
        }}
        onMarkUnread={(deliveryId) => {
          act({
            deliveryId,
            run: () => markRead.mutateAsync({ deliveryId, isRead: false }),
            failure: "Couldn't mark the message unread",
          });
          show({ filter });
        }}
        onReply={({ deliveryId, payload }) => {
          act({
            deliveryId,
            run: () => reply.mutateAsync({ deliveryId, payload, idempotencyKey: `reply-${deliveryId}-${crypto.randomUUID()}` }),
            failure: "Couldn't send the reply",
          });
        }}
        pendingIds={pendingIds}
        now={now}
      />
      <ComposeMessage isOpen={isComposing} onOpenChange={setIsComposing} />
    </ListLayout>
  );
}
