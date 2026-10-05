'use client';

import type { DeliveryId, MessageRecipient, Party, UndeliverableDelivery } from '@aeolus-fleet/common';
import { ChevronRight, CircleCheck, RotateCw } from 'lucide-react';

import { classNames } from '../../lib/class-names';
import { canResend } from '../../lib/needs-attention';
import { isJson } from '../../lib/payload';
import { clockTime, duration, fullDateTime, shortDateTime } from '../../lib/relative-time';
import { OPERATOR_NAME } from '../../lib/sentence';
import { Button } from '../atoms/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../atoms/table';
import { EmptyState } from '../molecules/empty-state';
import { InlineError } from '../molecules/inline-error';
import { LoadingSkeleton } from '../molecules/loading-skeleton';
import { ShipName } from '../molecules/ship-name';
import { StatusBadge } from '../molecules/status-badge';

interface NeedsAttentionListProps {
  /** Oldest first, as the server lists them. */
  deliveries: readonly UndeliverableDelivery[];
  state: 'loading' | 'error' | 'ready';
  /** The error state's Try again. */
  onRetry: () => void;
  /** Resend and Dismiss: left out for a session that may not manage the fleet (a viewer's), whose rows offer neither. */
  onResend?: (deliveryId: DeliveryId) => void;
  onDismiss?: (deliveryId: DeliveryId) => void;
  /** Opens the message: a click on the row's message, or the phone card's chevron. */
  onOpen: (delivery: UndeliverableDelivery) => void;
  /** Deliveries whose resend or dismiss is in flight: their buttons are disabled and show pending. */
  pendingIds: ReadonlySet<DeliveryId>;
  /** The time "since" is measured from. */
  now: Date;
}

const DAY_MS = 24 * 60 * 60 * 1_000;

/** A party as the list names it: argo reads "argo (you)", any other ship carries its id suffix. */
function PartyName({ party }: { party: Party }) {
  const isOperator = party.name === OPERATOR_NAME;
  return (
    <ShipName name={party.name} shipId={party.id} size="meta" isOperator={isOperator} isSuffixShown={!isOperator} />
  );
}

function recipientWords(recipient: MessageRecipient): string {
  return recipient.kind === 'ship' ? recipient.ship.name : `any ship of type ${recipient.type}`;
}

/** "builder-core · 3K2P → tester-01 · Q8ZR": who sent it and who it was for. */
function Route({ delivery }: { delivery: UndeliverableDelivery }) {
  const { sender, recipient } = delivery.message;
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-meta text-muted-foreground">
      <PartyName party={sender} />
      <span aria-hidden>→</span>
      <span className="sr-only">to</span>
      {recipient.kind === 'ship' ? <PartyName party={recipient.ship} /> : <span>any ship of type {recipient.type}</span>}
    </span>
  );
}

/** The payload's first line, one line long: mono for JSON, sans otherwise. */
function Preview({ delivery }: { delivery: UndeliverableDelivery }) {
  const { payload, contentType } = delivery.message;
  return (
    <span
      className={classNames(
        'block min-w-0 truncate text-foreground',
        isJson(contentType) ? 'font-mono text-id' : 'text-body max-sm:text-body-touch',
      )}
      title={payload}
    >
      {payload.split('\n')[0]}
    </span>
  );
}

function reason(delivery: UndeliverableDelivery): string {
  return `Received ${String(delivery.attempts)} times, never acknowledged.`;
}

/** "the message from builder-core to tester-01": what an action's accessible name is about. */
function about(delivery: UndeliverableDelivery): string {
  return `the message from ${delivery.message.sender.name} to ${recipientWords(delivery.message.recipient)}`;
}

function Actions({
  delivery,
  onResend,
  onDismiss,
  pendingIds,
  layout,
}: Pick<NeedsAttentionListProps, 'onResend' | 'onDismiss' | 'pendingIds'> & {
  delivery: UndeliverableDelivery;
  layout: 'table' | 'phone';
}) {
  const isPending = pendingIds.has(delivery.deliveryId);
  const isPhone = layout === 'phone';
  if (onResend === undefined && onDismiss === undefined) {
    return null;
  }
  const resend = onResend !== undefined && canResend(delivery) ? (
    <Button
      size={isPhone ? 'touch' : 'sm'}
      variant={isPhone ? 'primary' : 'secondary'}
      icon={<RotateCw aria-hidden />}
      isLoading={isPending}
      data-testid="attention-resend"
      aria-label={`Resend ${about(delivery)}`}
      onClick={() => {
        onResend(delivery.deliveryId);
      }}
      className={isPhone ? 'flex-1' : undefined}
    >
      Resend
    </Button>
  ) : null;
  const dismiss = onDismiss === undefined ? null : (
    <Button
      size={isPhone ? 'touch' : 'sm'}
      variant={isPhone ? 'secondary' : 'ghost'}
      disabled={isPending}
      data-testid="attention-dismiss"
      aria-label={`Dismiss ${about(delivery)}`}
      onClick={() => {
        onDismiss(delivery.deliveryId);
      }}
      className={isPhone ? 'flex-1' : undefined}
    >
      Dismiss
    </Button>
  );
  return isPhone ? (
    <div className="flex gap-2 pt-1">
      {dismiss}
      {resend}
    </div>
  ) : (
    <div className="flex items-center justify-end gap-1.5">
      {resend}
      {dismiss}
    </div>
  );
}

function DesktopTable({ deliveries, onOpen, now, ...actions }: Omit<NeedsAttentionListProps, 'state' | 'onRetry'>) {
  return (
    <div className="flex flex-col gap-2 max-sm:hidden">
      <Table aria-label="Undeliverable deliveries">
        <TableHeader>
          <TableRow>
            <TableHead>State</TableHead>
            <TableHead>Message</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead>Since</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {deliveries.map((delivery) => {
            const since = new Date(delivery.since);
            return (
              <TableRow key={delivery.deliveryId} data-testid="attention-row" data-delivery-id={delivery.deliveryId}>
                <TableCell className="align-top">
                  <StatusBadge status="undeliverable" />
                </TableCell>
                <TableCell className="max-w-96 align-top">
                  <button
                    type="button"
                    aria-label={`Open ${about(delivery)}`}
                    onClick={() => {
                      onOpen(delivery);
                    }}
                    className="flex w-full min-w-0 flex-col gap-0.5 rounded-xs text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <Preview delivery={delivery} />
                    <Route delivery={delivery} />
                  </button>
                </TableCell>
                <TableCell className="max-w-48 align-top text-meta whitespace-normal text-muted-foreground">
                  {reason(delivery)}
                </TableCell>
                <TableCell className="align-top">
                  <span className="flex flex-col gap-0.5 tabular-nums">
                    <time dateTime={delivery.since} title={fullDateTime(since)} className="text-body text-foreground">
                      {shortDateTime(since)}
                    </time>
                    <span className="text-meta text-muted-foreground">{duration(since, now)} ago</span>
                  </span>
                </TableCell>
                <TableCell className="align-top">
                  <Actions delivery={delivery} layout="table" {...actions} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <p className="text-meta text-muted-foreground">
        Resend creates a new message with the same payload, linked to the original. Dismiss marks the delivery resolved.
        Abandoned deliveries are not listed here.
      </p>
    </div>
  );
}

function PhoneCards({ deliveries, onOpen, now, ...actions }: Omit<NeedsAttentionListProps, 'state' | 'onRetry'>) {
  return (
    <ul aria-label="Undeliverable deliveries" className="flex flex-col gap-3 sm:hidden">
      {deliveries.map((delivery) => {
        const since = new Date(delivery.since);
        const sinceWords = now.getTime() - since.getTime() < DAY_MS ? clockTime(since) : shortDateTime(since);
        return (
          <li
            key={delivery.deliveryId}
            data-testid="attention-row"
            data-delivery-id={delivery.deliveryId}
            className="flex flex-col gap-1.5 rounded-lg border border-border bg-card px-3.5 py-3"
          >
            <div className="flex items-center justify-between gap-3">
              <StatusBadge status="undeliverable" />
              <button
                type="button"
                aria-label={`Open ${about(delivery)}`}
                onClick={() => {
                  onOpen(delivery);
                }}
                className="inline-flex items-center gap-1 rounded-xs text-meta text-muted-foreground tabular-nums focus-visible:outline-2 focus-visible:outline-ring [&_svg]:size-(--size-icon-sm)"
              >
                {duration(since, now)}
                <ChevronRight aria-hidden />
              </button>
            </div>
            <Preview delivery={delivery} />
            <Route delivery={delivery} />
            <p className="text-meta text-muted-foreground">
              {reason(delivery)} Since{' '}
              <time dateTime={delivery.since} title={fullDateTime(since)} className="tabular-nums">
                {sinceWords}
              </time>
              .
            </p>
            <Actions delivery={delivery} layout="phone" {...actions} />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Needs attention (docs/design/png/NeedsAttentionList.png): undeliverable
 * deliveries only, oldest first. Each offers Resend (a new message with the
 * same payload, linked to the original) and Dismiss (resolved, kept in the
 * audit trail); the page removes it from the list and says so with a Toast.
 * Abandoned deliveries never appear here. Phone: one card per delivery.
 */
export function NeedsAttentionList({ deliveries, state, onRetry, ...rest }: NeedsAttentionListProps) {
  if (state === 'loading') {
    return (
      <div data-slot="needs-attention-list" data-state="loading">
        <LoadingSkeleton variant="table" rows={2} label="Loading Needs attention" className="max-sm:hidden" />
        <LoadingSkeleton variant="list" rows={2} label="Loading Needs attention" className="sm:hidden" />
      </div>
    );
  }
  if (state === 'error') {
    return (
      <div data-slot="needs-attention-list" data-state="error" data-testid="attention-error">
        <InlineError
          variant="page"
          title="Couldn’t load Needs attention"
          description="This page couldn’t reach the fleet server. Undeliverable deliveries are kept on the server, so nothing is lost."
          onRetry={onRetry}
        />
      </div>
    );
  }
  if (deliveries.length === 0) {
    return (
      <div data-slot="needs-attention-list" data-state="empty" data-testid="attention-empty">
        <EmptyState
          icon={<CircleCheck className="text-tone-ok-fg" />}
          title="Nothing needs your attention"
          description="Undeliverable deliveries show up here as soon as they happen."
        />
      </div>
    );
  }
  return (
    <div data-slot="needs-attention-list" data-state="ready" className="flex flex-col gap-3">
      <DesktopTable deliveries={deliveries} {...rest} />
      <PhoneCards deliveries={deliveries} {...rest} />
    </div>
  );
}
