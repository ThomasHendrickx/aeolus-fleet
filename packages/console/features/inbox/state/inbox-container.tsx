'use client';

import type { AnswerChoice, DeliveryId } from '@aeolus-fleet/common';
import { ChevronDown } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useAccess } from '../../../lib/access';
import { useConsoleFrame } from '../../../lib/console-frame';
import { inboxPathOf, readInboxFilter, useAnswer, useInboxEntries, useMarkDone, useMarkRead, useReply } from '../../../lib/inbox';
import { isOpenEntry, type InboxEntry } from '../../../lib/inbox-entry';
import { useLiveFleet } from '../../../lib/live-fleet';
import { useNow } from '../../../lib/now';
import { useSignInWhenSessionEnds } from '../../../lib/session';
import { Button } from '../../../components/atoms/button';
import { showToast } from '../../../components/atoms/toast';
import { ListPage } from '../../../components/organisms/list-page';
import { TopBar } from '../../../components/organisms/top-bar';
import { useThread } from '../hooks/use-thread';
import { neighbourOf, questionPositionOf } from '../services/inbox-moves';
import { inboxViewOf, openQuestionsOf, segmentCounts, todayOf, waitingOf, type InboxView } from '../services/inbox-view';
import { MessageMenu } from '../ui/molecules/message-menu';
import { OperatorInbox } from '../ui/organisms/operator-inbox';

/** The refusal's words, safe to show: the server's message. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Try again in a moment.';
}

/** Every row in list order: questions, messages, then the plugin ships' messages. */
function orderOf(view: InboxView): DeliveryId[] {
  return [...view.questions, ...view.messages, ...view.pluginMessages].map(({ deliveryId }) => deliveryId);
}

/**
 * argo's one inbox, live (#849): the questions and messages the web app's
 * server laid out, Open, Done or All, with the open one beside the list or as
 * a page of its own on the phone. Opening a message marks it read; Done,
 * Reply and Answer acknowledge it. The segment and the open one live in the
 * URL, read on the web app's server (page.tsx).
 */
export function InboxContainer({ filterParameter, selectedId }: { filterParameter?: string; selectedId?: DeliveryId }) {
  const router = useRouter();
  const now = useNow();
  const segment = readInboxFilter(filterParameter);
  const inbox = useInboxEntries();
  const markRead = useMarkRead();
  const markDone = useMarkDone();
  const reply = useReply();
  const answer = useAnswer();
  const liveFleet = useLiveFleet();
  const frame = useConsoleFrame();
  const access = useAccess();
  useSignInWhenSessionEnds([liveFleet.error]);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<DeliveryId>>(new Set());
  const [isPluginGroupExpanded, setIsPluginGroupExpanded] = useState(false);
  const [isPluginGroupPending, setIsPluginGroupPending] = useState(false);

  const entries = inbox.data ?? [];
  const view = inboxViewOf(entries, segment);
  const order = orderOf(view);
  const selected = entries.find((entry) => entry.deliveryId === selectedId);
  const openQuestionIds = openQuestionsOf(entries).map(({ deliveryId }) => deliveryId);
  const questionPosition = selected?.kind === 'question' ? questionPositionOf(openQuestionIds, selected.deliveryId) : undefined;
  const thread = useThread(selected?.kind === 'message' ? selected.inReplyTo : undefined);

  const show = (next: { segment?: typeof segment; deliveryId?: DeliveryId }) => {
    router.replace(inboxPathOf({ filter: next.segment ?? segment, deliveryId: next.deliveryId }), { scroll: false });
  };
  const open = (deliveryId: DeliveryId | undefined) => {
    show({ deliveryId });
    const chosen: InboxEntry | undefined = entries.find((entry) => entry.deliveryId === deliveryId);
    // A read-only session (a viewer's) marks nothing read: opening a message changes nothing.
    if (chosen?.readAt === null && chosen.state !== 'acknowledged' && access.canReceive) {
      markRead.mutate({ deliveryId: chosen.deliveryId, isRead: true });
    }
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
  const markUnread = (deliveryId: DeliveryId) => {
    act({ deliveryId, run: () => markRead.mutateAsync({ deliveryId, isRead: false }), failure: 'Couldn’t mark the message unread' });
    show({});
  };
  const openPluginMessages = view.pluginMessages.filter(isOpenEntry);

  const phoneTopBar =
    selected === undefined ? undefined : (
      <TopBar
        title=""
        live={liveFleet.live}
        back={{ href: inboxPathOf({ filter: segment }), label: 'Inbox' }}
        actions={
          selected.kind === 'question' ? (
            questionPosition?.number === undefined ? undefined : (
              <>
                <span className="text-body-touch text-muted-foreground" data-testid="inbox-question-position">
                  {questionPosition.number} of {questionPosition.count}
                </span>
                {questionPosition.next === undefined ? null : (
                  <Button
                    variant="ghost"
                    size="touch"
                    isIconOnly
                    aria-label="Next question"
                    icon={<ChevronDown />}
                    data-testid="inbox-next-question-top"
                    onClick={() => {
                      open(questionPosition.next);
                    }}
                  />
                )}
              </>
            )
          ) : (
            <MessageMenu
              messageId={selected.messageId}
              shipId={selected.sender.id}
              shipName={selected.sender.name}
              size="touch"
              onMarkUnread={
                selected.state === 'acknowledged' || !access.canReceive
                  ? undefined
                  : () => {
                      markUnread(selected.deliveryId);
                    }
              }
            />
          )
        }
      />
    );

  return (
    <ListPage {...frame} title="Inbox" live={liveFleet.live} phoneTopBar={phoneTopBar}>
      <OperatorInbox
        state={inbox.isError ? 'error' : inbox.data === undefined ? 'loading' : 'ready'}
        onRetry={() => {
          void inbox.refetch();
        }}
        view={view}
        segment={segment}
        onSegmentChange={(next) => {
          show({ segment: next });
        }}
        counts={inbox.data === undefined ? {} : segmentCounts(entries)}
        waiting={waitingOf(entries, now)}
        today={todayOf(entries, now)}
        selected={selected}
        thread={thread}
        questionPosition={questionPosition}
        order={order}
        onSelect={open}
        onMove={(direction) => {
          const next = neighbourOf(order, { current: selected?.deliveryId, direction });
          if (next !== undefined && next !== selected?.deliveryId) {
            open(next);
          }
        }}
        isPluginGroupExpanded={isPluginGroupExpanded}
        onTogglePluginGroup={() => {
          setIsPluginGroupExpanded((isExpanded) => !isExpanded);
        }}
        onPluginGroupDone={
          access.canReceive && openPluginMessages.length > 0
            ? () => {
                setIsPluginGroupPending(true);
                // Each delivery is acknowledged as Mark done does it, one by one; a refusal of one leaves the others done.
                void Promise.allSettled(openPluginMessages.map(({ deliveryId }) => markDone.mutateAsync({ deliveryId })))
                  .then((results) => {
                    const refused = results.filter((result) => result.status === 'rejected').length;
                    if (refused > 0) {
                      showToast({ title: 'Couldn’t mark every message done', description: `${String(refused)} of ${String(results.length)} were not marked done. Try again in a moment.`, tone: 'error' });
                    }
                  })
                  .finally(() => {
                    setIsPluginGroupPending(false);
                  });
              }
            : undefined
        }
        isPluginGroupPending={isPluginGroupPending}
        onMarkDone={(deliveryId) => {
          act({ deliveryId, run: () => markDone.mutateAsync({ deliveryId }), failure: 'Couldn’t mark the message done' });
        }}
        onMarkUnread={markUnread}
        onReply={({ deliveryId, payload }) => {
          act({
            deliveryId,
            run: () => reply.mutateAsync({ deliveryId, payload, idempotencyKey: `reply-${deliveryId}-${crypto.randomUUID()}` }),
            failure: 'Couldn’t send the reply',
          });
        }}
        onAnswer={({ deliveryId, answer: choice }: { deliveryId: DeliveryId; answer: AnswerChoice }) => {
          act({
            deliveryId,
            run: () => answer.mutateAsync({ deliveryId, answer: choice, idempotencyKey: `answer-${deliveryId}-${crypto.randomUUID()}` }),
            failure: 'Couldn’t send the answer',
          });
        }}
        pendingIds={pendingIds}
        now={now}
        isReadOnly={!access.canReceive}
      />
    </ListPage>
  );
}
