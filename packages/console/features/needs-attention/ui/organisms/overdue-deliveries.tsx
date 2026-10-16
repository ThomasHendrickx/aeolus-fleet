import type { OverdueDelivery } from '@aeolus-fleet/common';
import { AlarmClock, ChevronRight } from 'lucide-react';

import { classNames } from '../../../../lib/class-names';
import { overdueReason } from '../../../../lib/needs-attention';
import { isJson } from '../../../../lib/payload';
import { fullDateTime, relativeTime } from '../../../../lib/relative-time';
import { ShipName } from '../../../../components/molecules/ship-name';
import { StatusBadge } from '../../../../components/molecules/status-badge';

interface OverdueDeliveriesProps {
  /** Oldest told first, as the server lists them. */
  deliveries: readonly OverdueDelivery[];
  /** Opens the message on the page of the ship it is overdue on. */
  onOpen: (delivery: OverdueDelivery) => void;
  /** The time "told" is measured from. */
  now: Date;
}

/**
 * The deliveries argo was told are overdue (decision 0040): the ship whose 10
 * or 60 minute clock ran out, the state and the clock, when argo was told,
 * the message, and Open to it. No action: each clears by itself once its
 * delivery moves on or its lease ends.
 */
export function OverdueDeliveries({ deliveries, onOpen, now }: OverdueDeliveriesProps) {
  return (
    <ul data-testid="overdue-deliveries" aria-label="Overdue deliveries" className="divide-y divide-border overflow-hidden rounded-lg border border-border">
      {deliveries.map((delivery) => {
        const { payload, contentType } = delivery.message;
        const toldAt = new Date(delivery.toldAt);
        return (
          <li key={delivery.deliveryId} data-testid="overdue-row" data-delivery-id={delivery.deliveryId} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2.5">
            <StatusBadge status="overdue" />
            <span className="flex min-w-0 grow basis-48 flex-col gap-0.5">
              <span className="flex flex-wrap items-baseline gap-x-1.5 text-body text-foreground max-sm:text-body-touch">
                <ShipName name={delivery.ship.name} shipId={delivery.ship.id} size="meta" />
                <span className="text-meta text-muted-foreground">{overdueReason(delivery)}</span>
              </span>
              <span className={classNames('block min-w-0 truncate text-muted-foreground', isJson(contentType) ? 'font-mono text-id' : 'text-meta')} title={payload}>
                {payload.split('\n')[0]}
              </span>
            </span>
            <span className="inline-flex items-center gap-1.5 text-meta text-tone-attention-fg tabular-nums">
              <AlarmClock aria-hidden className="size-3.5 shrink-0" />
              <span>
                argo told at {String(delivery.minutes)} min ·{' '}
                <time dateTime={delivery.toldAt} title={fullDateTime(toldAt)}>
                  {relativeTime(toldAt, now).toLowerCase()}
                </time>
              </span>
            </span>
            <button
              type="button"
              data-testid="overdue-open"
              aria-label={`Open the message overdue on ${delivery.ship.name}`}
              onClick={() => {
                onOpen(delivery);
              }}
              className="inline-flex items-center gap-1 rounded-xs text-meta font-medium hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              Open
              <ChevronRight aria-hidden className="size-(--size-icon-sm)" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
