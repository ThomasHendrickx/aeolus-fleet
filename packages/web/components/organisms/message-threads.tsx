import type { ListedMessage, MessageId, ShipId } from '@aeolus-fleet/common';
import { ArrowDownLeft, ArrowUpRight, Mail, RotateCw } from 'lucide-react';

import { fullDateTime, relativeTime } from '../../lib/relative-time';
import { ship, text, type SentencePart } from '../../lib/sentence';
import { threadsOf } from '../../lib/threads';
import { Button } from '../atoms/button';
import { EmptyState } from '../molecules/empty-state';
import { InlineError } from '../molecules/inline-error';
import { LoadingSkeleton } from '../molecules/loading-skeleton';
import { Sentence } from '../molecules/sentence';
import { StatusBadge } from '../molecules/status-badge';

interface MessageThreadsProps {
  /** The ship whose page this is: a message is sent by it or received. */
  shipId: ShipId;
  /** The ship's messages, in any order. */
  messages: readonly ListedMessage[];
  state: 'ready' | 'loading' | 'error';
  onRetry?: () => void;
  /** The time relative times are measured from. */
  now: Date;
  onOpenMessage: (messageId: MessageId) => void;
}

/** "To planner", "To any ship of type reviewer" or "From planner", seen from the page's ship. */
function counterparty(message: ListedMessage, isSent: boolean): SentencePart[] {
  if (!isSent) {
    return [text('From '), ship(message.sender)];
  }
  return message.recipient.kind === 'ship'
    ? [text('To '), ship(message.recipient.ship)]
    : [text(`To any ship of type ${message.recipient.type}`)];
}

function MessageRow({
  message,
  shipId,
  now,
  onOpenMessage,
}: Pick<MessageThreadsProps, 'shipId' | 'now' | 'onOpenMessage'> & { message: ListedMessage }) {
  const isSent = message.sender.id === shipId;
  const Direction = isSent ? ArrowUpRight : ArrowDownLeft;
  const at = new Date(message.sentAt);
  return (
    <li className="border-b border-border last:border-b-0">
      <button
        type="button"
        data-testid="message-row"
        data-message-id={message.id}
        aria-label={`${isSent ? 'Sent' : 'Received'} message: ${message.preview}`}
        className="flex w-full items-start gap-3 px-3.5 py-3 text-left transition-colors duration-(--duration-fast) hover:bg-accent"
        onClick={() => {
          onOpenMessage(message.id);
        }}
      >
        <span
          aria-hidden
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-tone-ended-border bg-tone-ended-bg text-tone-ended-fg [&_svg]:size-(--size-icon-sm)"
        >
          <Direction />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <Sentence parts={counterparty(message, isSent)} className="text-body text-foreground max-sm:text-body-touch" />
            <StatusBadge status={message.delivery.state} />
          </span>
          <span className="truncate text-meta text-muted-foreground">{message.preview}</span>
          <time dateTime={message.sentAt} title={fullDateTime(at)} className="text-meta text-muted-foreground tabular-nums">
            {relativeTime(at, now)}
          </time>
        </span>
      </button>
    </li>
  );
}

/**
 * The ship's messages as threads: a reply sits under the message it answers,
 * oldest first, and the thread with the latest message comes first. Each
 * message shows its direction, the other party, its delivery state and a
 * preview, and opens in the MessageSheet.
 */
export function MessageThreads({ shipId, messages, state, onRetry, now, onOpenMessage }: MessageThreadsProps) {
  if (state === 'loading') {
    return <LoadingSkeleton variant="list" rows={3} label="Loading the messages" />;
  }
  if (state === 'error') {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
        <InlineError title="Couldn’t load the messages" description="The rest of the page is current. Try again in a moment." />
        {onRetry ? (
          <Button size="sm" icon={<RotateCw aria-hidden />} onClick={onRetry} className="self-start">
            Try again
          </Button>
        ) : null}
      </div>
    );
  }
  if (messages.length === 0) {
    return (
      <EmptyState
        variant="section"
        icon={<Mail />}
        title="No messages yet"
        description="Messages this ship sends or receives appear here as they happen."
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {threadsOf(messages).map((thread) => (
        <section
          key={thread.id}
          data-testid="message-thread"
          aria-label={`Thread of ${String(thread.messages.length)} ${thread.messages.length === 1 ? 'message' : 'messages'}`}
          className="overflow-hidden rounded-lg border border-border bg-card"
        >
          <ol>
            {thread.messages.map((message) => (
              <MessageRow key={message.id} message={message} shipId={shipId} now={now} onOpenMessage={onOpenMessage} />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
