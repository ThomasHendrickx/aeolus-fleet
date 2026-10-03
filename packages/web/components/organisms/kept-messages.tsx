import { ChevronRight, Inbox } from 'lucide-react';
import Link from 'next/link';

import { relativeTime } from '../../lib/relative-time';
import type { KeptMessage } from '../../lib/squadrons-api';
import { EmptyState } from '../molecules/empty-state';
import { InlineError } from '../molecules/inline-error';
import { LoadingSkeleton } from '../molecules/loading-skeleton';

interface KeptMessagesProps {
  messages: readonly KeptMessage[];
  state: 'loading' | 'error' | 'ready';
  error?: string;
  onRetry: () => void;
  /** The flagship's id: a kept message opens on its ship page, whole. */
  flagshipId: string;
  now: Date;
}

/** The payload's first line, for the row; the message page shows it whole. */
function preview(payload: string): string {
  return payload.split('\n')[0] ?? '';
}

/**
 * The messages the squadron's flagship kept (docs/squadrons.md): a flagship
 * handles only the squadron's own messages; anything else is acknowledged,
 * kept here, never forwarded, and argo is told. Oldest first, each with its
 * sender, content type, when it came and its first line; it opens whole on
 * the flagship's page, so nothing hangs unseen.
 */
export function KeptMessages({ messages, state, error, onRetry, flagshipId, now }: KeptMessagesProps) {
  return (
    <section aria-labelledby="kept-messages" data-testid="kept-messages" className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h2 id="kept-messages" className="text-body font-semibold">
          Messages the flagship kept
        </h2>
        <p className="text-meta text-muted-foreground">Messages to the flagship it does not handle: kept here, never forwarded.</p>
      </div>
      {state === 'loading' ? (
        <LoadingSkeleton variant="list" rows={2} label="Loading the kept messages" />
      ) : state === 'error' ? (
        <InlineError title="Couldn't load the kept messages" description="The rest of the page is current. Try again in a moment." detail={error} onRetry={onRetry} />
      ) : messages.length === 0 ? (
        <EmptyState variant="section" icon={<Inbox aria-hidden />} title="No kept messages" description="Every message to the flagship was the squadron's own." />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {messages.map((message) => (
            <li key={message.deliveryId} data-testid="kept-message">
              <Link
                href={`/ships/${flagshipId}?tab=messages&message=${message.messageId}`}
                className="flex items-center gap-3 px-3 py-2.5 hover:bg-accent"
              >
                <span className="flex min-w-0 grow flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-x-2 text-meta">
                    <span className="font-medium text-foreground">{message.senderName}</span>
                    <span className="font-mono text-muted-foreground">{message.contentType}</span>
                    <time dateTime={message.receivedAt} className="text-muted-foreground">
                      {relativeTime(new Date(message.receivedAt), now)}
                    </time>
                  </span>
                  <span className="truncate text-body">{preview(message.payload)}</span>
                </span>
                <ChevronRight aria-hidden className="size-(--size-icon) shrink-0 text-muted-foreground" />
                <span className="sr-only">Open the message</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
