'use client';

import type { AnswerChoice, DeliveryId } from '@aeolus-fleet/common';
import { CircleCheck } from 'lucide-react';
import { useEffect } from 'react';

import type { InboxEntry } from '../../../../lib/inbox-entry';
import type { ThreadMessage } from '../../../../lib/inbox-thread';
import { counted } from '../../../../lib/sentence';
import { Button, Kbd } from '@aeolus-fleet/common/header';
import { EmptyState } from '../../../../components/molecules/empty-state';
import { InlineError } from '../../../../components/molecules/inline-error';
import { LoadingSkeleton } from '../../../../components/molecules/loading-skeleton';
import type { QuestionPosition } from '../../services/inbox-moves';
import type { InboxView } from '../../services/inbox-view';
import { InboxList, type InboxListProps } from './inbox-list';
import { MessageReader, REPLY_FIELD_SELECTOR } from './message-reader';
import { QuestionReader, type AnswerDraft } from './question-reader';

export interface OperatorInboxProps extends Omit<InboxListProps, 'onSelect' | 'selectedId'> {
  state: 'loading' | 'error' | 'ready';
  onRetry: () => void;
  /** What the operator did today, for the empty Open segment. */
  today: { answered: number; done: number };
  /** The open question or message, from the URL. */
  selected: InboxEntry | undefined;
  /** The thread of the open message; undefined while it loads. */
  thread: readonly ThreadMessage[] | undefined;
  /** Where the open question stands among the open ones. */
  questionPosition: QuestionPosition | undefined;
  /** Every row in list order, for J and K. */
  order: readonly DeliveryId[];
  onSelect: (deliveryId: DeliveryId | undefined) => void;
  onMarkDone: (deliveryId: DeliveryId) => void;
  onMarkUnread: (deliveryId: DeliveryId) => void;
  onReply: (reply: { deliveryId: DeliveryId; payload: string }) => void;
  onAnswer: (answer: { deliveryId: DeliveryId; answer: AnswerChoice }) => void;
  onMove: (direction: 'next' | 'previous') => void;
  /** Deliveries whose mark done, reply or answer is in flight. */
  pendingIds: ReadonlySet<DeliveryId>;
  /** The answers that were not sent, by question, with why (#870). */
  answerFailures?: ReadonlyMap<DeliveryId, { answer: AnswerChoice; message: string }>;
  /** The choices and notes left unsent, by question, held again when it opens (#870). */
  answerDrafts?: ReadonlyMap<DeliveryId, AnswerDraft>;
  onAnswerDraftChange?: (change: { deliveryId: DeliveryId; draft: AnswerDraft | undefined }) => void;
  isReadOnly?: boolean;
}

/** Whether a key press belongs to a field or a menu, where J, K, E and R are text. */
function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [role="menu"], [role="dialog"]') !== null);
}

/** The visible reply field: the desktop pane's, while the phone page is hidden. */
function visibleReplyField(): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>(REPLY_FIELD_SELECTOR)].find((field) => field.offsetParent !== null);
}

/** Desktop keys (#849): J and K move, E marks the open message done, R goes to the reply. Never the only way. */
function useInboxKeys({ selected, onMove, onMarkDone, isReadOnly }: Pick<OperatorInboxProps, 'selected' | 'onMove' | 'onMarkDone' | 'isReadOnly'>) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing || isTyping(event.target)) {
        return;
      }
      switch (event.key.toLowerCase()) {
        case 'j':
          event.preventDefault();
          onMove('next');
          return;
        case 'k':
          event.preventDefault();
          onMove('previous');
          return;
        case 'e':
          if (selected?.kind === 'message' && selected.state !== 'acknowledged' && isReadOnly !== true) {
            event.preventDefault();
            onMarkDone(selected.deliveryId);
          }
          return;
        case 'r': {
          const field = visibleReplyField();
          if (field !== undefined) {
            event.preventDefault();
            field.focus();
          }
          return;
        }
        default:
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [selected, onMove, onMarkDone, isReadOnly]);
}

function Reader({ selected, isPhone, ...props }: OperatorInboxProps & { selected: InboxEntry; isPhone: boolean }) {
  const isPending = props.pendingIds.has(selected.deliveryId);
  if (selected.kind === 'question') {
    return (
      <QuestionReader
        key={selected.deliveryId}
        question={selected}
        position={props.questionPosition ?? { number: undefined, count: 0, next: undefined, left: 0 }}
        isPhone={isPhone}
        onAnswer={(answer) => {
          props.onAnswer({ deliveryId: selected.deliveryId, answer });
        }}
        onSelect={props.onSelect}
        isPending={isPending}
        now={props.now}
        isReadOnly={props.isReadOnly}
        failure={props.answerFailures?.get(selected.deliveryId)}
        draft={props.answerDrafts?.get(selected.deliveryId)}
        onDraftChange={(draft) => {
          props.onAnswerDraftChange?.({ deliveryId: selected.deliveryId, draft });
        }}
      />
    );
  }
  return (
    <MessageReader
      key={selected.deliveryId}
      message={selected}
      thread={props.thread}
      isPhone={isPhone}
      onReply={(payload) => {
        props.onReply({ deliveryId: selected.deliveryId, payload });
      }}
      onMarkDone={() => {
        props.onMarkDone(selected.deliveryId);
      }}
      onMarkUnread={() => {
        props.onMarkUnread(selected.deliveryId);
      }}
      isPending={isPending}
      isReadOnly={props.isReadOnly}
    />
  );
}

function ReaderToolbar({ selected, questionPosition, onMove }: Pick<OperatorInboxProps, 'selected' | 'questionPosition' | 'onMove'>) {
  if (selected?.kind !== 'question') {
    return null;
  }
  const number = questionPosition?.number;
  return (
    <div className="flex items-center gap-1 border-b border-border px-5 py-2.5">
      <span className="text-meta text-muted-foreground" data-testid="inbox-question-position">
        {number === undefined ? 'Question' : `Question ${String(number)} of ${String(questionPosition?.count ?? 0)}`}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto"
        aria-keyshortcuts="K"
        onClick={() => {
          onMove('previous');
        }}
      >
        Previous <Kbd aria-hidden>K</Kbd>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-keyshortcuts="J"
        onClick={() => {
          onMove('next');
        }}
      >
        Next <Kbd aria-hidden>J</Kbd>
      </Button>
    </div>
  );
}

function Empty({ segment, today, onSegmentChange }: Pick<OperatorInboxProps, 'segment' | 'today' | 'onSegmentChange'>) {
  if (segment === 'open') {
    const did =
      today.answered + today.done === 0
        ? ''
        : `You answered ${counted(today.answered, { one: 'question', many: 'questions' })} and marked ${counted(today.done, { one: 'message', many: 'messages' })} done today. `;
    return (
      <div data-testid="inbox-empty" className="flex grow items-center justify-center p-6 max-sm:p-0">
        <EmptyState
          icon={<CircleCheck />}
          title="Nothing waits for you"
          description={`${did}New ones show up here as ships send them.`}
          action={
            <Button
              variant="ghost"
              onClick={() => {
                onSegmentChange('done');
              }}
            >
              See done
            </Button>
          }
        />
      </div>
    );
  }
  return (
    <div data-testid="inbox-empty" className="flex grow items-center justify-center p-6 max-sm:p-0">
      <EmptyState
        icon={<CircleCheck />}
        title={segment === 'done' ? 'Nothing done yet' : 'No messages for you'}
        description={
          segment === 'done'
            ? 'Questions you answer and messages you mark done show up here.'
            : 'When a ship asks argo a question or sends it a message, it shows up here.'
        }
      />
    </div>
  );
}

function isEmpty(view: InboxView): boolean {
  return view.questions.length + view.messages.length + view.pluginMessages.length === 0;
}

/**
 * argo's one inbox (#849, docs/design/png/OperatorInbox.png): questions on top,
 * then messages, then the plugin ships' messages folded. Desktop is two
 * panes, the list beside the open question or message with its bar pinned at
 * the bottom, and keys (J, K, E, R, ⌘↵). Phone is the list, and an open
 * question or message is a page of its own with its bar at the bottom; the
 * TabBar hides there. Read-only, for a viewer session, it shows everything
 * and changes nothing (decision 0022).
 */
export function OperatorInbox(props: OperatorInboxProps) {
  const { state, onRetry, view, segment, selected, onSelect } = props;
  useInboxKeys(props);
  if (state === 'loading') {
    return (
      <div data-slot="operator-inbox" data-state="loading" className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <LoadingSkeleton variant="list" rows={5} label="Loading your inbox" />
        <LoadingSkeleton variant="detail" label="Loading the message" className="max-sm:hidden" />
      </div>
    );
  }
  if (state === 'error') {
    return (
      <div data-slot="operator-inbox" data-state="error" data-testid="inbox-error">
        <InlineError
          variant="page"
          title="Couldn’t load your inbox"
          description="This page couldn’t reach the fleet server. Messages to argo are stored on the server, so nothing is lost."
          onRetry={onRetry}
        />
      </div>
    );
  }
  const list = (
    <InboxList
      {...props}
      selectedId={selected?.deliveryId}
      onSelect={(deliveryId) => {
        onSelect(deliveryId);
      }}
    />
  );
  return (
    <div data-slot="operator-inbox" data-state="ready" className="flex grow flex-col">
      <div className="grid h-[calc(100dvh-12rem)] min-h-128 grid-cols-[minmax(20rem,24rem)_minmax(0,1fr)] overflow-hidden rounded-lg border border-border bg-card max-sm:hidden">
        <div className="flex min-h-0 flex-col overflow-y-auto border-r border-border">
          {list}
          {isEmpty(view) && !props.more ? <Empty segment={segment} today={props.today} onSegmentChange={props.onSegmentChange} /> : null}
        </div>
        <div className="flex min-h-0 flex-col bg-background">
          {selected ? (
            <>
              <ReaderToolbar selected={selected} questionPosition={props.questionPosition} onMove={props.onMove} />
              <Reader {...props} selected={selected} isPhone={false} />
            </>
          ) : (
            <p className="m-auto text-meta text-muted-foreground">
              {isEmpty(view) ? null : props.isReadOnly === true ? 'Choose a question or message to read it.' : 'Choose a question to answer it, or a message to read it. J and K move.'}
            </p>
          )}
        </div>
      </div>
      <div className="flex grow flex-col gap-3 sm:hidden" data-hides-tab-bar={selected ? '' : undefined}>
        {selected ? (
          <Reader {...props} selected={selected} isPhone />
        ) : (
          <>
            {list}
            {isEmpty(view) && !props.more ? <Empty segment={segment} today={props.today} onSegmentChange={props.onSegmentChange} /> : null}
          </>
        )}
      </div>
    </div>
  );
}

