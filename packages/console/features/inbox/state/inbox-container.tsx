'use client';

import type { AnswerChoice, DeliveryId } from '@aeolus-fleet/common';
import { ChevronDown } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { useAccess } from '../../../lib/access';
import { useConsoleFrame } from '../../../lib/console-frame';
import { inboxPathOf, readInboxFilter, useAnswer, useInboxEntries, useMarkDone, useMarkRead, useOpenInboxCount, useReply } from '../../../lib/inbox';
import { isOpenEntry, type InboxEntry } from '../../../lib/inbox-entry';
import { useLiveFleet } from '../../../lib/live-fleet';
import { useNow } from '../../../lib/now';
import { useSignInWhenSessionEnds } from '../../../lib/session';
import { Button } from '@aeolus-fleet/common/header';
import { showToast } from '../../../components/atoms/toast';
import { LoadMore } from '../../../components/molecules/load-more';
import { ListPage } from '../../../components/organisms/list-page';
import { TopBar } from '../../../components/organisms/top-bar';
import { useThread } from '../hooks/use-thread';
import { answerAttemptOf, type AnswerAttempt } from '../services/answer-attempt';
import { neighbourOf, questionPositionOf } from '../services/inbox-moves';
import { inboxViewOf, openQuestionsOf, waitingOf, type InboxView } from '../services/inbox-view';
import { MessageMenu } from '../ui/molecules/message-menu';
import { OperatorInbox } from '../ui/organisms/operator-inbox';
import type { AnswerDraft } from '../ui/organisms/question-reader';

/** The refusal's words, safe to show: the server's message. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Try again in a moment.';
}

/** The answers that were not sent, by question, as the question page shows them. */
function failuresOf(attempts: ReadonlyMap<DeliveryId, AnswerAttempt>): Map<DeliveryId, { answer: AnswerChoice; message: string }> {
  const failures = new Map<DeliveryId, { answer: AnswerChoice; message: string }>();
  for (const [deliveryId, { answer, failure }] of attempts) {
    if (failure !== undefined) {
      failures.set(deliveryId, { answer, message: failure });
    }
  }
  return failures;
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
  const inbox = useInboxEntries(segment);
  const openCount = useOpenInboxCount();
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
  // Each question's answer since it was last sent, kept until the fleet takes it, so a failed one stays on its question to send again (#870).
  const [answerAttempts, setAnswerAttempts] = useState<ReadonlyMap<DeliveryId, AnswerAttempt>>(new Map());
  // The choices and notes left unsent on each question, held again when it opens (#870).
  const [answerDrafts, setAnswerDrafts] = useState<ReadonlyMap<DeliveryId, AnswerDraft>>(new Map());
  // The one open now: leaving a question with a draft, or a send that fails after the operator moved on, needs a toast to be seen.
  const openIdRef = useRef(selectedId);

  const entries = inbox.items ?? [];
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
  const keepDraft = (deliveryId: DeliveryId, draft: AnswerDraft | undefined) => {
    setAnswerDrafts((drafts) => {
      const next = new Map(drafts);
      if (draft === undefined) {
        next.delete(deliveryId);
      } else {
        next.set(deliveryId, draft);
      }
      return next;
    });
  };
  // The URL holds the open question, so every way to leave one (a row, J and K, the arrows, Next, the back link, the browser) ends here.
  useEffect(() => {
    const left = openIdRef.current;
    openIdRef.current = selectedId;
    if (left === undefined || left === selectedId || !answerDrafts.has(left)) {
      return;
    }
    const asked = inbox.items?.find((entry) => entry.deliveryId === left);
    if (asked?.kind === 'question' && isOpenEntry(asked)) {
      showToast({ title: `Your answer to “${asked.question.title}” is not sent`, description: 'Your choice and note wait on the question. Answer sends them.', tone: 'info' });
    }
  }, [selectedId, answerDrafts, inbox.items]);
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
        state={inbox.isFailed ? 'error' : inbox.items === undefined ? 'loading' : 'ready'}
        onRetry={inbox.retry}
        view={view}
        segment={segment}
        onSegmentChange={(next) => {
          show({ segment: next });
        }}
        counts={openCount === undefined ? {} : { open: openCount }}
        more={
          inbox.hasMore ? (
            <LoadMore what="older messages" isLoading={inbox.isLoadingMore} isFailed={inbox.isLoadMoreFailed} onLoad={inbox.loadMore} area="inbox" />
          ) : null
        }
        waiting={waitingOf(entries, now)}
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
          const attempt = answerAttemptOf({ previous: answerAttempts.get(deliveryId), answer: choice, newKey: `answer-${deliveryId}-${crypto.randomUUID()}` });
          const keep = (kept: AnswerAttempt | undefined) => {
            setAnswerAttempts((attempts) => {
              const next = new Map(attempts);
              if (kept === undefined) {
                next.delete(deliveryId);
              } else {
                next.set(deliveryId, kept);
              }
              return next;
            });
          };
          keep(attempt);
          keepDraft(deliveryId, undefined);
          const asked = entries.find((entry) => entry.deliveryId === deliveryId);
          const title = asked?.kind === 'question' ? asked.question.title : 'the question';
          setPendingIds((pending) => new Set([...pending, deliveryId]));
          answer
            .mutateAsync({ deliveryId, answer: choice, idempotencyKey: attempt.idempotencyKey })
            .then(() => {
              keep(undefined);
            })
            .catch((error: unknown) => {
              keep({ ...attempt, failure: messageOf(error) });
              // The question says why on its page; one the operator already left says it here too, so it is never lost unseen.
              if (openIdRef.current !== deliveryId) {
                showToast({ title: `Your answer to “${title}” was not sent`, description: messageOf(error), tone: 'error' });
              }
              // A send that reached the fleet before it failed shows answered.
              inbox.retry();
            })
            .finally(() => {
              setPendingIds((pending) => new Set([...pending].filter((id) => id !== deliveryId)));
            });
        }}
        pendingIds={pendingIds}
        answerFailures={failuresOf(answerAttempts)}
        answerDrafts={answerDrafts}
        onAnswerDraftChange={({ deliveryId, draft }) => {
          keepDraft(deliveryId, draft);
        }}
        now={now}
        isReadOnly={!access.canReceive}
      />
    </ListPage>
  );
}
