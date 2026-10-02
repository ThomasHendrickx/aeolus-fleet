import type { ShipDetail, ShipId } from '@aeolus-fleet/common';
import { Archive, CircleAlert, Info, KeyRound, UserRound } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { classNames } from '../../lib/class-names';
import { clockTime, dayDate, duration, fullDateTime, lastSeen, shortDateTime } from '../../lib/relative-time';
import { Badge } from '../atoms/badge';
import { Button } from '../atoms/button';
import { CopyButton } from '../atoms/copy-button';
import { Skeleton } from '../atoms/skeleton';
import { EmptyState } from '../molecules/empty-state';
import { LocationTag } from '../molecules/location-tag';
import { PingStatus } from '../molecules/ping-status';
import { ReportStatus } from '../molecules/report-status';
import { ShipName } from '../molecules/ship-name';
import { StatusBadge } from '../molecules/status-badge';

const DAY_MS = 24 * 60 * 60 * 1000;

interface ShipHeaderProps {
  /** The ship, once loaded. */
  ship: ShipDetail | undefined;
  /** The id the page was opened with, named when no such ship exists. */
  shipId?: ShipId;
  state: 'ready' | 'loading' | 'not-found';
  /** The ship's actions, as its state allows: Get starting prompt, Release. None for argo or a retired ship. */
  actions?: ReactNode;
  /** The time "Crewed since" is measured to. */
  now: Date;
  /** Where "Back to fleet overview" goes. */
  backHref?: string;
}

function MetaCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-card px-3.5 py-3">
      <dt className="text-meta text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1.5 text-body text-foreground">{children}</dd>
    </div>
  );
}

/** "14:21 · 11 min", or "26 Sep, 08:02 · 1 d 2 h" for a crew aboard over a day. */
function crewedSince(since: Date, now: Date): string {
  const when = now.getTime() - since.getTime() < DAY_MS ? clockTime(since) : shortDateTime(since);
  return `${when} · ${duration(since, now)}`;
}

function MetaStrip({ ship, now }: { ship: ShipDetail; now: Date }) {
  const isOperator = ship.kind === 'operator';
  const since = ship.crewedSince === null ? null : new Date(ship.crewedSince);
  const commissionedAt = new Date(ship.commissionedAt);
  return (
    <dl className="grid grid-cols-4 gap-px overflow-hidden rounded-lg border border-border bg-border max-sm:grid-cols-2">
      <MetaCell label="Location">
        <span className="inline-flex min-w-0 flex-col gap-0.5">
          <LocationTag kind={ship.location?.kind ?? null} description={ship.location?.description} size="md" />
          {ship.lastSeenAt === null ? null : (
            <time
              dateTime={ship.lastSeenAt}
              title={fullDateTime(new Date(ship.lastSeenAt))}
              data-testid="ship-last-seen"
              className="text-meta text-muted-foreground tabular-nums"
            >
              {lastSeen(new Date(ship.lastSeenAt), now)}
            </time>
          )}
          <PingStatus ping={ship.ping} now={now} testId="ship-ping-status" />
          <ReportStatus report={ship.report} now={now} testId="ship-report" />
        </span>
      </MetaCell>
      <MetaCell label="Crewed since">
        {since ? (
          <time dateTime={ship.crewedSince ?? undefined} title={fullDateTime(since)} className="tabular-nums">
            {crewedSince(since, now)}
          </time>
        ) : (
          <span className="text-muted-foreground">Not crewed</span>
        )}
      </MetaCell>
      <MetaCell label="Commissioned">
        <time dateTime={ship.commissionedAt} title={fullDateTime(commissionedAt)}>
          {isOperator ? `Fleet created ${dayDate(commissionedAt)}` : dayDate(commissionedAt)}
        </time>
      </MetaCell>
      <MetaCell label="Ship id">
        <span className="truncate font-mono text-id">{ship.id}</span>
        <CopyButton value={ship.id} label="Copy ship id" />
      </MetaCell>
    </dl>
  );
}

function Notice({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 rounded-lg border border-border bg-muted px-3.5 py-2.5 text-meta text-muted-foreground [&_svg]:size-(--size-icon-sm) [&_svg]:shrink-0">
      {icon}
      <span>{children}</span>
    </p>
  );
}

/**
 * The top of the ship page (docs/design/png/ShipHeader.png): name, status,
 * type or the operator chip, the actions its state allows, and a meta strip
 * of where it runs, since when it is crewed, when it was commissioned and its
 * id. argo says it is the operator's ship; a retired ship is read-only.
 */
export function ShipHeader({ ship, shipId, state, actions, now, backHref = '/' }: ShipHeaderProps) {
  if (state === 'loading' || (state === 'ready' && ship === undefined)) {
    return (
      <div aria-busy data-testid="ship-header" className="flex flex-col gap-4">
        <span className="sr-only">Loading the ship</span>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-6 w-16" />
        </div>
        <Skeleton className="h-16 w-full rounded-lg" />
      </div>
    );
  }
  if (state === 'not-found' || ship === undefined) {
    return (
      <div data-testid="ship-header">
        <EmptyState
          variant="section"
          icon={<CircleAlert />}
          title="Ship not found"
          description={
            <>
              No ship with the id {shipId ? <span className="font-mono text-id">{shipId}</span> : 'given'} exists in
              this fleet. The link may be incomplete. Retired ships keep their page.
            </>
          }
          action={
            <Button
              size="sm"
              nativeButton={false}
              render={({ children, ...props }) => (
                <Link href={backHref} {...props}>
                  {children}
                </Link>
              )}
            >
              Back to fleet overview
            </Button>
          }
        />
      </div>
    );
  }

  const isOperator = ship.kind === 'operator';
  const isRetired = ship.status === 'retired';
  return (
    <div data-testid="ship-header" className="flex flex-col gap-4 max-sm:gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5 max-sm:flex-col max-sm:items-start max-sm:gap-1.5">
          <h1 className="min-w-0">
            <ShipName name={ship.name} shipId={ship.id} size="title" isSuffixShown={isRetired} />
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={ship.status} />
            {isOperator ? (
              <Badge variant="kind">
                <UserRound aria-hidden />
                operator
              </Badge>
            ) : (
              <>
                <Badge variant="type">{ship.type}</Badge>
                {ship.scopes
                  .filter((scope) => scope === 'fleet:read' || scope === 'fleet:manage')
                  .map((scope) => (
                    <Badge key={scope} variant="kind" data-testid="ship-fleet-scope">
                      {scope}
                    </Badge>
                  ))}
              </>
            )}
            {ship.status === 'awaitingCrew' && ship.startingPrompt === null ? (
              <span className="inline-flex items-center gap-1.5 text-meta text-muted-foreground [&_svg]:size-(--size-icon-sm)">
                <KeyRound aria-hidden />
                No starting prompt issued
              </span>
            ) : null}
          </div>
        </div>
        {actions && !isRetired ? (
          <div className={classNames('flex flex-wrap items-center gap-2', 'max-sm:w-full max-sm:[&>*]:flex-1')}>
            {actions}
          </div>
        ) : null}
      </div>
      {isOperator ? (
        <Notice icon={<Info aria-hidden />}>
          argo is your ship. This console session crews it. It can’t be released, renamed or retired.
        </Notice>
      ) : null}
      {isRetired && ship.retiredAt !== null ? (
        <Notice icon={<Archive aria-hidden />}>
          Retired on {fullDateTime(new Date(ship.retiredAt))}. Read-only.
        </Notice>
      ) : null}
      <MetaStrip ship={ship} now={now} />
    </div>
  );
}
