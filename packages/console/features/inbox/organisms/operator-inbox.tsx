'use client';

import type { DeliveryId, InboxFilter, InboxMessage } from '@aeolus-fleet/common';
import { Check, ChevronLeft, CircleCheck, Inbox, Send } from 'lucide-react';
import { useId, useState } from 'react';

import { classNames } from '../../../lib/class-names';
import { formattedPayload, isJson } from '../../../lib/payload';
import { clockTime, fullDateTime, shortDateTime } from '../../../lib/relative-time';
import { sendShortcutAria, submitOnSendShortcut, useShortcutPlatform } from '../../../lib/send-shortcut';
import { Button } from '../../../components/atoms/button';
import { Label } from '../../../components/atoms/label';
import { Tabs, TabsCount, TabsList, TabsTrigger } from '../../../components/atoms/tabs';
import { Textarea } from '../../../components/atoms/textarea';
import { EmptyState } from '../../../components/molecules/empty-state';
import { InlineError } from '../../../components/molecules/inline-error';
import { LoadingSkeleton } from '../../../components/molecules/loading-skeleton';
import { SendShortcutHint } from '../../../components/molecules/send-shortcut-hint';
import { ShipName } from '../../../components/molecules/ship-name';

interface OperatorInboxProps {
  /** Already filtered and newest first, from the server. */
  messages: readonly InboxMessage[];
  filter: InboxFilter;
  onFilterChange: (filter: InboxFilter) => void;
  /** Counts for the segmented filter: open, done, all; undefined hides a count. */
  counts: { open?: number; done?: number; all?: number };
  /** The open message, from the URL. */
  selectedId: DeliveryId | undefined;
  /** Opens a message; undefined goes back to the list on phone. */
  onSelect: (deliveryId: DeliveryId | undefined) => void;
  state: 'loading' | 'error' | 'ready';
  onRetry: () => void;
  onMarkDone: (deliveryId: DeliveryId) => void;
  onMarkUnread: (deliveryId: DeliveryId) => void;
  onReply: (reply: { deliveryId: DeliveryId; payload: string }) => void;
  /** Deliveries whose mark done or reply is in flight. */
  pendingIds: ReadonlySet<DeliveryId>;
  now: Date;
  /** A session that may not receive (a viewer's): no Mark done, Mark as unread or Reply, and a note that says so. */
  isReadOnly?: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1_000;

const FILTERS: readonly { value: InboxFilter; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'done', label: 'Done' },
  { value: 'all', label: 'All' },
];

function isDone(message: InboxMessage): boolean {
  return message.state === 'acknowledged';
}

/** "14:30" today, "28 Sep, 14:30" before. */
function listTime(at: Date, now: Date): string {
  return now.getTime() - at.getTime() < DAY_MS ? clockTime(at) : shortDateTime(at);
}

function FilterTabs({
  filter,
  onFilterChange,
  counts,
}: Pick<OperatorInboxProps, 'filter' | 'onFilterChange' | 'counts'>) {
  return (
    <Tabs
      value={filter}
      onValueChange={(next: unknown) => {
        const chosen = FILTERS.find((each) => each.value === next);
        if (chosen) {
          onFilterChange(chosen.value);
        }
      }}
    >
      <TabsList aria-label="Show" className="max-sm:w-full">
        {FILTERS.map(({ value, label }) => (
          <TabsTrigger key={value} value={value} data-testid={`inbox-filter-${value}`} className="max-sm:grow">
            {label}
            {counts[value] === undefined ? null : <TabsCount>{counts[value]}</TabsCount>}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

/** The payload's first line, one line long: mono for JSON, sans otherwise. */
function Preview({ message }: { message: InboxMessage }) {
  const { payload, contentType } = message.message;
  return (
    <span
      className={classNames(
        'block min-w-0 truncate text-muted-foreground',
        isJson(contentType) ? 'font-mono text-id' : 'text-meta max-sm:text-body',
      )}
    >
      {payload.split('\n')[0]}
    </span>
  );
}

function MessageList({
  messages,
  selectedId,
  onSelect,
  now,
}: Pick<OperatorInboxProps, 'messages' | 'selectedId' | 'onSelect' | 'now'>) {
  return (
    <ul aria-label="Messages to argo" className="flex flex-col max-sm:gap-2">
      {messages.map((message) => {
        const sentAt = new Date(message.message.sentAt);
        const isUnread = message.readAt === null && !isDone(message);
        const isSelected = message.deliveryId === selectedId;
        return (
          <li key={message.deliveryId}>
            <button
              type="button"
              data-testid="inbox-row"
              data-delivery-id={message.deliveryId}
              aria-current={isSelected ? 'true' : undefined}
              onClick={() => {
                onSelect(message.deliveryId);
              }}
              className="relative flex w-full min-w-0 flex-col gap-1 border-b border-border py-2.5 pr-3 pl-5 text-left transition-colors duration-(--duration-fast) outline-none hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring aria-[current=true]:bg-accent max-sm:rounded-lg max-sm:border max-sm:bg-card max-sm:py-3"
            >
              {isUnread ? (
                <span aria-hidden className="absolute top-4 left-2 size-1.5 rounded-full bg-primary max-sm:top-4.5" />
              ) : null}
              <span className="flex min-w-0 items-center gap-2">
                {isDone(message) ? (
                  <CircleCheck aria-hidden className="size-(--size-icon-sm) shrink-0 text-muted-foreground" />
                ) : null}
                <ShipName
                  name={message.message.sender.name}
                  shipId={message.message.sender.id}
                  isSuffixShown
                  className={classNames('min-w-0', isUnread ? 'font-semibold' : undefined, isDone(message) ? 'text-muted-foreground' : undefined)}
                />
                <time
                  dateTime={message.message.sentAt}
                  title={fullDateTime(sentAt)}
                  className="ml-auto shrink-0 text-meta text-muted-foreground tabular-nums"
                >
                  {listTime(sentAt, now)}
                </time>
              </span>
              <Preview message={message} />
              {isUnread ? <span className="sr-only">Unread</span> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** "Done. Acknowledged at 13:58, when you replied." */
function DoneNotice({ message }: { message: InboxMessage }) {
  if (message.doneAt === null) {
    return null;
  }
  const doneAt = new Date(message.doneAt);
  return (
    <p
      data-testid="inbox-done-notice"
      className="flex items-center gap-2 rounded-md border border-tone-ok-border bg-tone-ok-bg px-3 py-2 text-meta text-tone-ok-fg [&_svg]:size-(--size-icon-sm) [&_svg]:shrink-0"
    >
      <CircleCheck aria-hidden />
      Done. Acknowledged at{' '}
      <time dateTime={message.doneAt} title={fullDateTime(doneAt)}>
        {clockTime(doneAt)}
      </time>
      {message.repliedWith === null ? '.' : ', when you replied.'}
    </p>
  );
}

function Payload({ message }: { message: InboxMessage }) {
  const { payload, contentType } = message.message;
  const formatted = formattedPayload(payload, contentType);
  return (
    <pre
      className={classNames(
        'max-h-96 overflow-auto rounded-md border border-border bg-card px-3.5 py-3 whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]',
        isJson(contentType) ? 'font-mono text-code' : 'font-sans text-body max-sm:text-body-touch',
      )}
    >
      {formatted ?? payload}
    </pre>
  );
}

function ReplyBox({
  message,
  onReply,
  isPending,
  isPhone,
}: {
  message: InboxMessage;
  onReply: OperatorInboxProps['onReply'];
  isPending: boolean;
  isPhone: boolean;
}) {
  const fieldId = useId();
  const hintId = useId();
  const [draft, setDraft] = useState('');
  const platform = useShortcutPlatform();
  const sender = message.message.sender.name;
  return (
    <form
      className="flex flex-col gap-1.5 border-t border-border pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (draft.trim() !== '' && !isPending) {
          onReply({ deliveryId: message.deliveryId, payload: draft });
        }
      }}
    >
      <Label htmlFor={fieldId}>Reply to {sender}</Label>
      <Textarea
        id={fieldId}
        rows={3}
        size={isPhone ? 'touch' : 'md'}
        placeholder="Write a reply"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onKeyDown={submitOnSendShortcut}
        aria-describedby={hintId}
        data-testid="inbox-reply"
      />
      <div className="flex items-center justify-between gap-3">
        <p id={hintId} className="text-meta text-muted-foreground">
          {isDone(message) ? 'Sent as a new message.' : 'Sending also marks this one done.'}
        </p>
        <Button
          type="submit"
          variant="primary"
          size={isPhone ? 'touch' : 'sm'}
          icon={<Send aria-hidden />}
          isLoading={isPending}
          disabled={draft.trim() === '' && !isPending}
          aria-keyshortcuts={platform === null ? undefined : sendShortcutAria(platform)}
          data-testid="inbox-reply-send"
        >
          Send reply
          {platform === null ? null : <SendShortcutHint platform={platform} />}
        </Button>
      </div>
    </form>
  );
}

function MessagePane({
  message,
  onMarkDone,
  onMarkUnread,
  onReply,
  pendingIds,
  isPhone,
  isReadOnly = false,
}: Pick<OperatorInboxProps, 'onMarkDone' | 'onMarkUnread' | 'onReply' | 'pendingIds' | 'isReadOnly'> & {
  message: InboxMessage;
  isPhone: boolean;
}) {
  const isPending = pendingIds.has(message.deliveryId);
  const sentAt = new Date(message.message.sentAt);
  const sender = message.message.sender;
  return (
    <article
      aria-label={`Message from ${sender.name}`}
      data-testid="inbox-message"
      className={classNames('flex min-h-0 flex-col gap-3', isPhone ? 'grow' : 'h-full')}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="min-w-0 text-heading font-semibold">
            <ShipName name={sender.name} shipId={sender.id} isSuffixShown />
          </h2>
          <p className="text-meta text-muted-foreground">
            To argo ·{' '}
            <time dateTime={message.message.sentAt} title={fullDateTime(sentAt)}>
              {shortDateTime(sentAt)}
            </time>
          </p>
        </div>
        {isDone(message) || isReadOnly ? null : (
          <div className="flex items-center gap-1.5">
            <Button
              size={isPhone ? 'touch' : 'sm'}
              icon={<Check aria-hidden />}
              isLoading={isPending}
              data-testid="inbox-mark-done"
              onClick={() => {
                onMarkDone(message.deliveryId);
              }}
            >
              Mark done
            </Button>
            <Button
              variant="ghost"
              size={isPhone ? 'touch' : 'sm'}
              disabled={isPending}
              data-testid="inbox-mark-unread"
              onClick={() => {
                onMarkUnread(message.deliveryId);
              }}
            >
              Mark as unread
            </Button>
          </div>
        )}
      </header>
      <DoneNotice message={message} />
      <div className="min-h-0 grow overflow-y-auto">
        <Payload message={message} />
      </div>
      {isReadOnly ? (
        <p data-testid="inbox-read-only" className="border-t border-border pt-3 text-meta text-muted-foreground">
          Read-only: you see argo’s inbox, and can’t reply or mark messages done.
        </p>
      ) : (
      <div className={isPhone ? 'sticky bottom-0 bg-background pb-[env(safe-area-inset-bottom)]' : undefined}>
        <ReplyBox
          // A message that becomes done starts a fresh reply; a failed reply keeps its draft.
          key={`${message.deliveryId}-${message.state}`}
          message={message}
          onReply={onReply}
          isPending={isPending}
          isPhone={isPhone}
        />
      </div>
      )}
    </article>
  );
}

/**
 * argo's inbox (docs/design/png/OperatorInbox.png): the messages ships sent to
 * the operator. Read is not done: opening a message marks it read (the page
 * does that); Mark done or Reply acknowledges it, and Mark as unread brings
 * back the dot. Open, Done and All filter the list. Desktop is two panes, the
 * list beside the open message with its reply box. Phone is the list, and an
 * open message is a pushed page with the reply pinned to the bottom; the page
 * hides the TabBar there. Read-only, for a viewer session, it shows the
 * messages and nothing that changes them (decision 0022).
 */
export function OperatorInbox({
  messages,
  filter,
  onFilterChange,
  counts,
  selectedId,
  onSelect,
  state,
  onRetry,
  now,
  ...actions
}: OperatorInboxProps) {
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

  const selected = messages.find((message) => message.deliveryId === selectedId);
  const filterTabs = <FilterTabs filter={filter} onFilterChange={onFilterChange} counts={counts} />;
  const empty = (
    <div data-testid="inbox-empty">
      <EmptyState
        icon={<Inbox />}
        title={filter === 'done' ? 'Nothing done yet' : 'No messages for you'}
        description={
          filter === 'done'
            ? 'Messages you mark done or reply to show up here.'
            : 'When a ship sends a message to argo, it shows up here. You can reply from the message.'
        }
      />
    </div>
  );

  return (
    <div data-slot="operator-inbox" data-state="ready">
      <div className="grid min-h-128 grid-cols-[minmax(0,2fr)_minmax(0,3fr)] overflow-hidden rounded-lg border border-border bg-card max-sm:hidden">
        <div className="flex min-h-0 flex-col border-r border-border">
          <div className="border-b border-border p-2.5">{filterTabs}</div>
          {messages.length === 0 ? (
            <div className="p-4">{empty}</div>
          ) : (
            <MessageList messages={messages} selectedId={selectedId} onSelect={onSelect} now={now} />
          )}
        </div>
        <div className="flex min-h-0 flex-col bg-background p-5">
          {selected ? (
            <MessagePane message={selected} isPhone={false} {...actions} />
          ) : (
            <p className="m-auto text-meta text-muted-foreground">
              {messages.length === 0 ? null : actions.isReadOnly === true ? 'Choose a message to read it.' : 'Choose a message to read it and reply.'}
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-3 sm:hidden">
        {selected ? (
          <>
            <Button
              variant="ghost"
              size="touch"
              icon={<ChevronLeft aria-hidden />}
              className="-ml-2 self-start"
              data-testid="inbox-back"
              onClick={() => {
                onSelect(undefined);
              }}
            >
              Inbox
            </Button>
            <MessagePane message={selected} isPhone {...actions} />
          </>
        ) : (
          <>
            {filterTabs}
            {messages.length === 0 ? empty : <MessageList messages={messages} selectedId={selectedId} onSelect={onSelect} now={now} />}
          </>
        )}
      </div>
    </div>
  );
}
