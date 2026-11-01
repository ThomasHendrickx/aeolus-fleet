import type { DeliveryId, ShipStatus, StuckCause } from '@aeolus-fleet/common';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { Badge } from '../../../../components/atoms/badge';
import { Button } from '@aeolus-fleet/ui';
import { EmptyState } from '../../../../components/molecules/empty-state';
import { InlineError } from '../../../../components/molecules/inline-error';
import { LoadingSkeleton } from '../../../../components/molecules/loading-skeleton';
import { StatusBadge, statusLabel } from '../../../../components/molecules/status-badge';
import { duration, relativeTime, shortDateTime } from '../../../../lib/relative-time';
import { CAUSE_SENTENCES, messagePathOn, nextStepOf, placeName, waitMinutes, type StuckPlace } from '../../services/health-view';
import { WaitStrip } from '../molecules/wait-strip';

/** What the drill-down shows of a stuck ship besides the health read. */
export interface DrilldownShip {
  status: ShipStatus;
  type: string;
  lastSeenAt: string | null;
}

/** What a row shows of a stuck delivery's message, once read. */
export interface DrilldownMessage {
  preview: string;
  sender: { id: string; name: string };
  isPing: boolean;
}

interface StuckDrilldownProps {
  cause: StuckCause;
  state: 'loading' | 'error' | 'ready';
  places: readonly StuckPlace[];
  ships: ReadonlyMap<string, DrilldownShip>;
  messages: ReadonlyMap<string, DrilldownMessage>;
  onRetry: () => void;
  /** Resend and Dismiss, on an undeliverable delivery; none for a viewer. */
  onResend?: (deliveryId: DeliveryId) => void;
  onDismiss?: (deliveryId: DeliveryId) => void;
  pendingIds: ReadonlySet<DeliveryId>;
  /** Load more, after the places shown, when more follow; none when they are all. */
  more?: ReactNode;
  now: Date;
}

const STATE_BADGES = { pending: 'pending', received: 'received', handed: 'handed', undeliverable: 'undeliverable' } as const;

function PlaceHeader({ place, ship, now }: { place: StuckPlace; ship: DrilldownShip | undefined; now: Date }) {
  const where = place.place;
  const step = place.cause === 'undeliverable' ? null : nextStepOf(place);
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-2">
        <h2 className="flex flex-wrap items-center gap-2 text-section font-semibold text-foreground">
          {where.kind === 'ship' ? where.ship.name : <Badge variant="type">{where.type}</Badge>}
          {ship !== undefined && <StatusBadge status={ship.status} />}
          {ship !== undefined && <Badge variant="type">{ship.type}</Badge>}
        </h2>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-meta">
          {where.kind === 'ship' && ship?.lastSeenAt != null && (
            <div>
              <dt className="text-muted-foreground">Session last seen</dt>
              <dd className="text-foreground" title={shortDateTime(new Date(ship.lastSeenAt))}>
                {relativeTime(new Date(ship.lastSeenAt), now)}
              </dd>
            </div>
          )}
          {where.kind === 'ship' && where.machine !== null && (
            <div>
              <dt className="text-muted-foreground">Machine</dt>
              <dd className="text-foreground">
                {where.machine.name}
                {where.machine.lastSeenAt !== null && ` · last seen ${relativeTime(new Date(where.machine.lastSeenAt), now)}`}
              </dd>
            </div>
          )}
          {where.kind === 'type' && (
            <div>
              <dt className="text-muted-foreground">Sent to</dt>
              <dd className="text-foreground">Any ship of type {where.type}</dd>
            </div>
          )}
        </dl>
      </div>
      {step !== null && (
        <Button variant="secondary" size="sm" nativeButton={false} render={<Link href={step.href} />} className="max-sm:h-(--size-control-touch) max-sm:w-full" data-testid="drilldown-next-step">
          {step.label}
        </Button>
      )}
    </header>
  );
}

/**
 * One cause opened (mock-up A, drill-down): per place, the facts that
 * explain it and its one next step, then its deliveries one by one, with
 * the message, how long on the shared scale, since when and the state each
 * waits in. An undeliverable one offers Resend (never a ping) and Dismiss.
 */
export function StuckDrilldown({ cause, state, places, ships, messages, onRetry, onResend, onDismiss, pendingIds, more, now }: StuckDrilldownProps) {
  if (state === 'error') {
    return <InlineError variant="page" title="Couldn’t load the stuck deliveries" description="Nothing changed in the fleet. The page tries again by itself." onRetry={onRetry} />;
  }
  if (state === 'loading') {
    return <LoadingSkeleton variant="cards" rows={2} label="Loading the stuck deliveries" />;
  }
  if (places.length === 0) {
    return (
      <EmptyState
        title={`Nothing ${statusLabel(cause).toLowerCase()}`}
        description="No delivery is stuck for this cause now."
        action={
          <Button variant="secondary" nativeButton={false} render={<Link href="/fleet-health" />}>
            <ArrowLeft aria-hidden />
            Back to Health
          </Button>
        }
      />
    );
  }
  return (
    <div data-testid="drilldown" className="flex flex-col gap-5 max-sm:gap-3.5">
      <p className="text-body text-muted-foreground max-sm:text-body-touch">{CAUSE_SENTENCES[cause]}</p>
      {places.map((place) => {
        const ship = place.place.kind === 'ship' ? ships.get(place.place.ship.id) : undefined;
        return (
          <section
            key={place.place.kind === 'ship' ? place.place.ship.id : place.place.type}
            aria-label={placeName(place.place)}
            data-testid="drilldown-place"
            className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3"
          >
            <PlaceHeader place={place} ship={ship} now={now} />
            <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto_auto] gap-x-4 max-sm:grid-cols-1">
              <div className="col-span-4 grid grid-cols-subgrid border-b border-border pb-2 text-caption font-medium text-muted-foreground max-sm:hidden">
                <span>Message</span>
                <span>How long (1 min to 7 d)</span>
                <span>Since</span>
                <span>State</span>
              </div>
              <ul className="col-span-4 grid grid-cols-subgrid divide-y divide-border max-sm:col-span-1">
                {place.deliveries.map((delivery) => {
                  const message = messages.get(delivery.messageId);
                  const opensOn = place.place.kind === 'ship' ? place.place.ship.id : message?.sender.id;
                  const isPending = pendingIds.has(delivery.deliveryId);
                  return (
                    <li key={delivery.deliveryId} data-testid="drilldown-row" data-delivery-id={delivery.deliveryId} className="col-span-4 grid grid-cols-subgrid items-center gap-y-2 py-3 max-sm:col-span-1">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        {opensOn === undefined ? (
                          <span className="truncate text-body text-foreground">{message?.preview ?? '…'}</span>
                        ) : (
                          <Link href={messagePathOn(opensOn, delivery.messageId)} className="truncate text-body text-foreground hover:underline" data-testid="drilldown-open">
                            {message === undefined ? 'Open the message' : message.preview}
                          </Link>
                        )}
                        {message !== undefined && <span className="text-meta text-muted-foreground">from {message.sender.name}</span>}
                      </div>
                      <WaitStrip waits={[waitMinutes(delivery.since, now)]} label={`Waiting ${duration(new Date(delivery.since), now)}`} />
                      <span className="text-meta tabular-nums text-muted-foreground" title={shortDateTime(new Date(delivery.since))}>
                        {shortDateTime(new Date(delivery.since))} · {duration(new Date(delivery.since), now)}
                      </span>
                      <span className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={STATE_BADGES[delivery.state]} />
                        {delivery.state === 'undeliverable' && onResend !== undefined && message !== undefined && !message.isPing && (
                          <Button variant="secondary" size="xs" disabled={isPending} onClick={() => { onResend(delivery.deliveryId); }} data-testid="drilldown-resend" className="max-sm:h-(--size-control-touch)">
                            Resend
                          </Button>
                        )}
                        {delivery.state === 'undeliverable' && onDismiss !== undefined && (
                          <Button variant="ghost" size="xs" disabled={isPending} onClick={() => { onDismiss(delivery.deliveryId); }} data-testid="drilldown-dismiss" className="max-sm:h-(--size-control-touch)">
                            Dismiss
                          </Button>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        );
      })}
      {more}
    </div>
  );
}
