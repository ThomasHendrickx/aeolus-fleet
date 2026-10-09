'use client';

import type { DeliveryId, InboxFilter } from '@aeolus-fleet/common';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { showToast } from '../../components/atoms/toast';
import { ComposeMessage } from '../../components/organisms/compose-message';
import { ConsoleCommands } from '../../components/organisms/console-commands';
import { ConsoleGuide } from '../../components/organisms/console-guide';
import { ConsoleNotices } from '../../components/organisms/console-notices';
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
import { useAccess } from '../../lib/access';
import { useLiveFleet } from '../../lib/live-fleet';
import { useAttentionCount } from '../../lib/needs-attention';
import { useNow } from '../../lib/now';
import { useAccountMenu } from '../../lib/account';
import { useSignInWhenSessionEnds } from '../../lib/session';
import { usePluginNav } from '../../lib/plugin-nav';

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
  const attentionCount = useAttentionCount();
  const liveFleet = useLiveFleet();
  const accountMenu = useAccountMenu(now);
  useSignInWhenSessionEnds([inbox.error, liveFleet.error]);
  const access = useAccess();
  const pluginNav = usePluginNav();
  const [isComposing, setIsComposing] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
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
      nav={{ active: 'inbox', inboxCount: filterCounts(all).open, attentionCount, ...pluginNav }}
      account={accountMenu}
      banner={
        <>
          <ConsoleNotices />
          <ConsoleGuide />
        </>
      }
      onCompose={
        access.canSend
          ? () => {
              setIsComposing(true);
            }
          : undefined
      }
      onSearch={() => {
        setIsSearching(true);
      }}
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
      <ComposeMessage isOpen={isComposing} onOpenChange={setIsComposing} />
      <ConsoleCommands
        isOpen={isSearching}
        onOpenChange={setIsSearching}
        onCompose={() => {
          setIsComposing(true);
        }}
      />
    </ListLayout>
  );
}
