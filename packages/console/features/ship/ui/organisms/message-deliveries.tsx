import { RecipientProgress } from '../molecules/recipient-progress';

import type { MessageDelivery } from '@aeolus-fleet/common';
import { RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@aeolus-fleet/common/header';

import { fullDateTime, relativeTime } from '../../../../lib/relative-time';
import { OPERATOR_NAME } from '../../../../lib/sentence';
import { InlineError } from '../../../../components/molecules/inline-error';
import { LoadingSkeleton } from '../../../../components/molecules/loading-skeleton';
import { ShipName } from '../../../../components/molecules/ship-name';
import { StatusBadge } from '../../../../components/molecules/status-badge';

interface MessageDeliveriesProps {
  /** By id, every page loaded so far. */
  deliveries: readonly MessageDelivery[];
  state: 'ready' | 'loading' | 'error';
  onRetry?: () => void;
  /** What ends the list while more deliveries follow: Load more. */
  more?: ReactNode;
  now: Date;
}

/**
 * The deliveries of a send to a label (decision 0065, R10), a page at a time:
 * one row per ship, its state and since when, each on its own. The list does
 * not tell a pushed hand-over from a pulled one, so a handed delivery reads
 * "Handed".
 */
export function MessageDeliveries({ deliveries, state, onRetry, more, now }: MessageDeliveriesProps) {
  if (state === 'loading') {
    return <LoadingSkeleton variant="list" rows={3} label="Loading the deliveries" />;
  }
  if (state === 'error') {
    return (
      <div data-testid="message-deliveries" className="flex flex-col gap-3">
        <InlineError title="Couldn’t load the deliveries" description="The rest of the message is current. Try again in a moment." />
        {onRetry ? (
          <Button size="sm" icon={<RotateCw aria-hidden />} onClick={onRetry} className="self-start">
            Try again
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <div data-testid="message-deliveries" className="flex flex-col">
      <ul aria-label="Deliveries" className="flex flex-col">
        {deliveries.map((delivery) => (
          <li
            key={delivery.id}
            data-testid="message-delivery"
            className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border py-2 first:pt-0 last:border-b-0 last:pb-0"
          >
            {delivery.ship ? (
              <ShipName name={delivery.ship.name} shipId={delivery.ship.id} isSuffixShown={delivery.ship.name !== OPERATOR_NAME} />
            ) : (
              <span className="text-body text-muted-foreground">No ship yet</span>
            )}
            <StatusBadge status={delivery.state === 'handed' ? 'handedPushed' : delivery.state} />
            <time dateTime={delivery.since} title={fullDateTime(new Date(delivery.since))} className="ml-auto text-meta text-muted-foreground tabular-nums max-sm:text-body-touch">
              {relativeTime(new Date(delivery.since), now)}
            </time>
            <RecipientProgress progress={delivery.progress} now={now} />
          </li>
        ))}
      </ul>
      <span className="mt-2 text-meta text-muted-foreground">Progress shows for a crew whose task is this message.</span>
      {more}
    </div>
  );
}
