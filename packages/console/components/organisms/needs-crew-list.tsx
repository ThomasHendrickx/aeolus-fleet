import type { ListedShip } from '@aeolus-fleet/common';
import { ListChecks, ShipWheel } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { crewRequestStage } from '../../lib/crew-request';
import { handCrewOf } from '../../lib/needs-crew';
import { clockTime, fullDateTime, relativeTime, shortDateTime } from '../../lib/relative-time';
import { Badge } from '../atoms/badge';
import { EmptyState } from '../molecules/empty-state';
import { InlineError } from '../molecules/inline-error';
import { LoadingSkeleton } from '../molecules/loading-skeleton';
import { StatusBadge } from '../molecules/status-badge';

const DAY_MS = 24 * 60 * 60 * 1000;

interface NeedsCrewListProps {
  /** The ships on Needs crew, oldest request first; undefined while the fleet loads. */
  ships: readonly ListedShip[] | undefined;
  hasTrierarchs: boolean;
  error?: string;
  onRetry: () => void;
  /** Each row's next step: Get starting prompt without the plugin, Release… on a crashed request with it. */
  actionOf?: (ship: ListedShip) => ReactNode;
  now: Date;
}

function Time({ at, now }: { at: string; now: Date }) {
  const when = new Date(at);
  return (
    <time dateTime={at} title={fullDateTime(when)} className="tabular-nums">
      {now.getTime() - when.getTime() < DAY_MS ? `Today, ${clockTime(when)}` : shortDateTime(when)}
    </time>
  );
}

/** How the ship stands for crewing by hand: no prompt yet, a prompt no session took, or a hand crew that ended. */
function HandCrew({ ship, now }: { ship: ListedShip; now: Date }) {
  const crew = handCrewOf(ship);
  switch (crew.kind) {
    case 'no-prompt':
      return <span className="text-muted-foreground">No starting prompt issued</span>;
    case 'prompt-unclaimed':
      return (
        <span className="flex flex-col">
          <span>
            Prompt issued <Time at={crew.issuedAt} now={now} />
          </span>
          <span className="text-muted-foreground">No session has taken it yet</span>
        </span>
      );
    case 'crew-ended':
      return (
        <span className="flex flex-col">
          <span>Was crewed by hand</span>
          {crew.endedAt === null ? null : (
            <span className="text-muted-foreground">
              Lease ended <Time at={crew.endedAt} now={now} />
            </span>
          )}
        </span>
      );
  }
}

/** Where the request stands with the plugin: its status and, while unassigned, why; and the trierarch it is assigned to. */
function PluginState({ ship }: { ship: ListedShip }) {
  const stage = crewRequestStage(ship);
  if (stage.kind === 'assigned') {
    return (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <StatusBadge status={stage.status} />
        <span className="inline-flex items-center gap-1">
          on
          <Link
            href={`/trierarchs/${stage.trierarch.id}`}
            className="inline-flex items-center gap-1 font-medium underline decoration-input underline-offset-3 [&_svg]:size-(--size-icon-sm) [&_svg]:text-muted-foreground"
          >
            <ShipWheel aria-hidden />
            {stage.trierarch.name}
          </Link>
        </span>
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <StatusBadge status="needsCrew" />
      <span className="text-muted-foreground">{stage.kind === 'needsCrew' && stage.reason !== null ? stage.reason : 'Not assigned yet'}</span>
    </span>
  );
}

const ROW = 'grid items-center gap-x-4 gap-y-1.5 px-4 py-3 max-sm:grid-cols-1 max-sm:px-3.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,11rem)]';

/**
 * Needs crew (canvas CrNeedsOff, CrNeedsOn, CrMNeeds; #245): the operator's
 * to-do of crew requests. Without the trierarch plugin, the ships to crew by
 * hand, each with whether a starting prompt is out; with it, the requests
 * that are not running, their status and trierarch. A row per ship, stacked
 * on phone.
 */
export function NeedsCrewList({ ships, hasTrierarchs, error, onRetry, actionOf, now }: NeedsCrewListProps) {
  if (error !== undefined) {
    return <InlineError variant="page" title="Couldn’t read the fleet" description="Nothing changed." detail={error} onRetry={onRetry} />;
  }
  if (ships === undefined) {
    return <LoadingSkeleton variant="table" rows={3} label="Loading Needs crew" />;
  }
  if (ships.length === 0) {
    return (
      <EmptyState
        icon={<ListChecks aria-hidden />}
        title="Nothing needs crew"
        description={
          hasTrierarchs
            ? 'Every crew request is running. A request shows here while it waits for a trierarch, is crewing, restarting or crashed.'
            : 'No ship with a crew request awaits crew. Request a crew on a ship’s page to put it here.'
        }
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-lg border border-border bg-card" data-testid="needs-crew-list">
        <div className={`${ROW} border-b border-border bg-muted py-2.5 text-caption font-medium text-muted-foreground max-sm:hidden`} aria-hidden>
          <span>Ship</span>
          <span>{hasTrierarchs ? 'Status' : 'Crew'}</span>
          <span>Requested</span>
          <span className="sr-only">Next step</span>
        </div>
        <ul className="divide-y divide-border">
          {ships.map((ship) => (
            <li key={ship.id} className={`${ROW} text-body`} data-testid="needs-crew-row">
              <span className="flex min-w-0 items-center gap-2">
                <Link href={`/ships/${ship.id}`} className="truncate font-medium hover:underline" data-testid="needs-crew-ship">
                  {ship.name}
                </Link>
                <Badge variant="type">{ship.type}</Badge>
              </span>
              <span className="min-w-0 text-meta">{hasTrierarchs ? <PluginState ship={ship} /> : <HandCrew ship={ship} now={now} />}</span>
              <span className="flex flex-col text-meta">
                {ship.crewRequest === null ? null : (
                  <>
                    <Time at={ship.crewRequest.requestedAt} now={now} />
                    {now.getTime() - new Date(ship.crewRequest.requestedAt).getTime() < DAY_MS ? (
                      <span className="text-muted-foreground">{relativeTime(new Date(ship.crewRequest.requestedAt), now)}</span>
                    ) : null}
                  </>
                )}
              </span>
              <span className="flex justify-end max-sm:justify-start">{actionOf?.(ship)}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-meta text-muted-foreground">
        {hasTrierarchs
          ? 'Running requests are not listed here; the fleet overview shows them. A request stays until you release the ship.'
          : 'A request stays until you remove it or release the ship. With the trierarch plugin, trierarchs crew these for you.'}
      </p>
    </div>
  );
}
