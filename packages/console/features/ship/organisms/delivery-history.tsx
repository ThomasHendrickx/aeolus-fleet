import type { DeliveryHistoryEntry, MessageRecipient } from '@aeolus-fleet/common';

import { deliveryHistorySentence, deliveryHistoryState, offsetTime } from '../lib/delivery-history';
import { fullDateTime, secondsTime } from '../../../lib/relative-time';
import { Badge } from '../../../components/atoms/badge';
import { Sentence } from '../molecules/sentence';
import { StatusBadge } from '../../../components/molecules/status-badge';

interface DeliveryHistoryProps {
  /** The delivery's changes, newest first: the first is its current state. */
  entries: readonly DeliveryHistoryEntry[];
  /** Who the message was for: one ship's inbox, or a type's queue. */
  recipient: MessageRecipient;
}

/**
 * The steps of one delivery's way, newest first
 * (docs/design/png/DeliveryHistory.png): StatusBadge, the time to the second
 * with how long after the store it came ("+2 s"), and one sentence naming who
 * held it and the part that took it. A type-addressed delivery shows its
 * claims and returns to the queue. Width is fluid; the same on phone.
 */
export function DeliveryHistory({ entries, recipient }: DeliveryHistoryProps) {
  const stored = entries.at(-1);
  const storedAt = stored ? new Date(stored.occurredAt) : undefined;
  return (
    <ol data-testid="delivery-history" aria-label="Delivery history" className="flex flex-col">
      {entries.map((entry, position) => {
        const at = new Date(entry.occurredAt);
        const isCurrent = position === 0;
        return (
          <li
            key={entry.seq}
            data-testid="delivery-history-entry"
            data-type={entry.type}
            className="relative flex gap-3 pb-4 last:pb-0"
          >
            <span aria-hidden className="relative flex w-3 shrink-0 justify-center">
              <span className="mt-1.5 size-2.5 rounded-full border-2 border-muted-foreground bg-card" />
              {position < entries.length - 1 ? (
                <span className="absolute top-5 bottom-[-0.25rem] w-px bg-border" />
              ) : null}
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={deliveryHistoryState(entry)} />
                <time dateTime={entry.occurredAt} title={fullDateTime(at)} className="font-mono text-id text-muted-foreground tabular-nums">
                  {secondsTime(at)}
                </time>
                {storedAt && position < entries.length - 1 ? (
                  <span data-testid="delivery-history-offset" className="font-mono text-id text-muted-foreground tabular-nums">
                    {offsetTime(storedAt, at)}
                  </span>
                ) : null}
                {isCurrent ? <Badge variant="outline">Current</Badge> : null}
              </div>
              <Sentence parts={deliveryHistorySentence(entry, { recipient, older: entries[position + 1] })} className="text-meta text-muted-foreground max-sm:text-body-touch" />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
