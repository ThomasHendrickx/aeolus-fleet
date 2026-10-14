import type { MessageId } from '@aeolus-fleet/common';
import { AlarmClock, ChevronRight } from 'lucide-react';

import { classNames } from '../../../lib/class-names';
import type { ShipWayView } from '../lib/ship-way';
import { StatusBadge } from '../../../components/molecules/status-badge';
import { WayLineItem } from './way-lines';

/**
 * A ship's side of the way (#756), in its header: the part that serves it,
 * a silent trierarch, its turn, then its oldest delivery waiting as its
 * StatusBadge and a few words, which open the message. Status never by
 * colour alone: every line carries its words.
 */
export function ShipWayLines({ view, onOpenMessage }: { view: ShipWayView; onOpenMessage: (messageId: MessageId) => void }) {
  const { lines, oldest } = view;
  return (
    <ul data-testid="ship-way" aria-label="Its side of the way" className="flex flex-col gap-1">
      {lines.map((line) => (
        <WayLineItem key={line.text} line={line} testId="ship-way-line" />
      ))}
      {oldest ? (
        <li>
          <button
            type="button"
            data-testid="ship-way-oldest"
            aria-label={`Open the oldest message waiting: ${oldest.text}`}
            onClick={() => {
              onOpenMessage(oldest.messageId);
            }}
            className="inline-flex flex-wrap items-center gap-1.5 rounded-xs text-left text-meta hover:underline focus-visible:outline-2 focus-visible:outline-ring max-sm:text-body-touch"
          >
            <StatusBadge status={oldest.status} />
            {oldest.isOverdue ? <AlarmClock aria-hidden className="size-3.5 shrink-0 text-tone-attention-fg" /> : null}
            <span className={classNames(oldest.isOverdue ? 'text-tone-attention-fg' : 'text-muted-foreground')}>{oldest.text}</span>
            <ChevronRight aria-hidden className="size-(--size-icon-sm)" />
          </button>
        </li>
      ) : null}
    </ul>
  );
}
