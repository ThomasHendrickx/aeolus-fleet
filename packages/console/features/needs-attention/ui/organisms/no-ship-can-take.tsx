import type { NoShipCanTakeDelivery } from '@aeolus-fleet/common';
import { ChevronRight } from 'lucide-react';

import { classNames } from '../../../../lib/class-names';
import { isJson } from '../../../../lib/payload';
import { duration, fullDateTime } from '../../../../lib/relative-time';
import { OPERATOR_NAME } from '../../../../lib/sentence';
import { Badge } from '../../../../components/atoms/badge';
import { ShipName } from '../../../../components/molecules/ship-name';

interface NoShipCanTakeProps {
  /** Oldest sent first, as the server lists them. */
  deliveries: readonly NoShipCanTakeDelivery[];
  /** Opens the message on its sender's page. */
  onOpen: (delivery: NoShipCanTakeDelivery) => void;
  /** The time the wait is measured from. */
  now: Date;
}

/**
 * The pending deliveries no ship can take (decision 0041): sent to a type no
 * active ship has, or none the sender may reach. Each with its type, its
 * message, who sent it and how long it waits, and Open to the message. No
 * action: commissioning a ship of the type lets it take them, and they clear
 * by themselves.
 */
export function NoShipCanTake({ deliveries, onOpen, now }: NoShipCanTakeProps) {
  return (
    <ul data-testid="no-ship-can-take" aria-label="Deliveries no ship can take" className="divide-y divide-border overflow-hidden rounded-lg border border-border">
      {deliveries.map((delivery) => {
        const { sender, payload, contentType } = delivery.message;
        const sentAt = new Date(delivery.message.sentAt);
        const isOperator = sender.name === OPERATOR_NAME;
        return (
          <li key={delivery.deliveryId} data-testid="no-ship-can-take-row" data-delivery-id={delivery.deliveryId} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2.5">
            <Badge variant="type">{delivery.type}</Badge>
            <span className="flex min-w-0 grow basis-48 flex-col gap-0.5">
              <span className={classNames('block min-w-0 truncate text-foreground', isJson(contentType) ? 'font-mono text-id' : 'text-body max-sm:text-body-touch')} title={payload}>
                {payload.split('\n')[0]}
              </span>
              <span className="flex flex-wrap items-baseline gap-x-1.5 text-meta text-muted-foreground">
                from <ShipName name={sender.name} shipId={sender.id} size="meta" isOperator={isOperator} isSuffixShown={!isOperator} />
              </span>
            </span>
            <span className="text-meta text-muted-foreground tabular-nums">
              waiting{' '}
              <time dateTime={delivery.message.sentAt} title={fullDateTime(sentAt)}>
                {duration(sentAt, now)}
              </time>
            </span>
            <button
              type="button"
              data-testid="no-ship-can-take-open"
              aria-label={`Open the message from ${sender.name} to any ship of type ${delivery.type}`}
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
