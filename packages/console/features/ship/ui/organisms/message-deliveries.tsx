import type { MessageDelivery } from '@aeolus-fleet/common';

import { fullDateTime, relativeTime } from '../../../../lib/relative-time';
import { OPERATOR_NAME } from '../../../../lib/sentence';
import { ShipName } from '../../../../components/molecules/ship-name';
import { StatusBadge } from '../../../../components/molecules/status-badge';

interface MessageDeliveriesProps {
  deliveries: readonly MessageDelivery[];
  now: Date;
}

/**
 * Every delivery of a send to a label (decision 0065, R10): one row per ship,
 * its state and since when, each on its own. The list does not tell a pushed
 * hand-over from a pulled one, so a handed delivery reads "Handed".
 */
export function MessageDeliveries({ deliveries, now }: MessageDeliveriesProps) {
  return (
    <ul aria-label="Deliveries" data-testid="message-deliveries" className="flex flex-col">
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
        </li>
      ))}
    </ul>
  );
}
