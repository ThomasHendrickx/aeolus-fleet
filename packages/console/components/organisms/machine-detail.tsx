import type { LocationKind, ShipId } from '@aeolus-fleet/common';
import { CircleAlert, CircleX, FolderX, LoaderCircle, Ship, ShipWheel, Trash2 } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { isClearing, type KeptWorktreeName } from '../../lib/clear-requests';
import { restartWords } from '../../lib/crew-request';
import type { LabelChip as LabelChipData } from '../../lib/labels';
import { clockTime, fullDateTime, sinceTime } from '../../lib/relative-time';
import type { Spot } from '../../lib/machines';
import type { Machine } from '../../lib/trierarch-plugin';
import { Button } from '../atoms/button';
import { CopyButton } from '../atoms/copy-button';
import { Skeleton } from '../atoms/skeleton';
import { CapacityBar } from '../molecules/capacity-bar';
import { EmptyState } from '../molecules/empty-state';
import { ShipLabels } from '../molecules/ship-labels';
import { LocationTag } from '../molecules/location-tag';
import { StatusBadge } from '../molecules/status-badge';
import { HarnessOffer, lastAnswer, MachineLiveness, WorkspaceOffer } from './machine-card';

interface MachineDetailProps {
  /** The machine, once read; undefined while it loads. */
  machine: Machine | undefined;
  state: 'ready' | 'loading' | 'not-found';
  spots: readonly Spot[];
  location: { kind: LocationKind; description: string | null } | null;
  /** Its trierarch ship's labels as chips, the trierarch plugin's os and arch among them; undefined while they load (#102). */
  labels?: readonly LabelChipData[];
  now: Date;
  /** The fleet's ship names by id, so a kept worktree names the ship it belonged to. */
  shipNames?: ReadonlyMap<string, string>;
  /** The pending clear requests (decision 0032): a kept worktree with one shows Clearing. */
  clearRequests?: readonly KeptWorktreeName[];
  /** Offered with fleet:manage: asks to delete a kept worktree, after a confirm. */
  onClearKept?: (kept: { shipId: ShipId; repository: string; shipName: string }) => void;
}

/** How a spot's session stands (#332): since when it runs, and its restart attempt, as its trierarch wrote them. */
function SpotSession({ spot, now }: { spot: Spot; now: Date }) {
  const startedAt = spot.status === 'running' ? spot.startedAt : null;
  const restarts = restartWords(spot);
  if (startedAt === null && restarts === undefined) {
    return null;
  }
  return (
    <span className="text-meta text-muted-foreground" data-testid="machine-spot-session">
      {startedAt === null ? null : (
        <>
          since{' '}
          <time dateTime={startedAt} title={fullDateTime(new Date(startedAt))} className="tabular-nums">
            {sinceTime(new Date(startedAt), now)}
          </time>
        </>
      )}
      {startedAt !== null && restarts !== undefined ? ' · ' : null}
      {restarts}
    </span>
  );
}

function MetaCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-card px-3.5 py-3">
      <dt className="text-meta text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1.5 text-body text-foreground">{children}</dd>
    </div>
  );
}

function Section({ title, count, note, children }: { title: string; count?: number; note?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2.5">
      <h2 className="flex items-baseline gap-2 text-section font-semibold">
        {title}
        {count === undefined ? null : <span className="text-meta font-normal text-muted-foreground tabular-nums">{count}</span>}
        {note === undefined ? null : <span className="text-meta font-normal text-muted-foreground">{note}</span>}
      </h2>
      {children}
    </section>
  );
}

/** A worktree the trierarch holds on to, read-only: clearing them from the console comes later (#325). */
function WorktreeRow({ icon, name, meta, action }: { icon: ReactNode; name: string; meta: string; action?: ReactNode }) {
  return (
    <li className="flex items-start gap-2 px-3.5 py-2.5 [&_svg]:mt-0.5 [&_svg]:size-(--size-icon-sm) [&_svg]:shrink-0 [&_svg]:text-muted-foreground">
      {icon}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-mono text-id">{name}</span>
        <span className="text-meta text-muted-foreground">{meta}</span>
      </span>
      {action}
    </li>
  );
}

/** A kept worktree, by its repository and the ship it belonged to: Clearing while a clear request waits, else Delete with fleet:manage. */
function KeptRow({ kept, shipName, isBeingCleared, onClear }: { kept: { shipId: ShipId; repository: string }; shipName: string; isBeingCleared: boolean; onClear: MachineDetailProps['onClearKept'] }) {
  const action = isBeingCleared ? (
    <Clearing />
  ) : onClear === undefined ? undefined : (
    <Button
      size="xs"
      variant="ghost"
      icon={<Trash2 aria-hidden />}
      aria-label={`Delete the kept ${kept.repository} worktree of ${shipName}`}
      data-testid="machine-worktree-delete"
      onClick={() => {
        onClear({ ...kept, shipName });
      }}
    >
      Delete
    </Button>
  );
  return <WorktreeRow icon={<FolderX aria-hidden />} name={`${kept.repository}/${shipName}`} meta="Kept after release, with uncommitted changes" action={action} />;
}

/** A kept worktree waiting for its trierarch to remove it: in the waiting tone, said in words. */
function Clearing() {
  return (
    <span
      data-testid="machine-worktree-clearing"
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-tone-waiting-border bg-tone-waiting-bg px-1.5 py-0.5 text-meta text-tone-waiting-fg [&_svg]:mt-0 [&_svg]:text-tone-waiting-fg"
    >
      <LoaderCircle aria-hidden />
      Clearing
    </span>
  );
}

/**
 * One machine's page (canvas TpMachine, TpMachineDown; #245): its trierarch,
 * whether it answers and a link to its ship page; its capacity, where it
 * runs, its version, its last answer and its ship id; the ships it runs; the
 * harnesses and workspaces it offers; and the worktrees it kept or found.
 * A kept worktree can be deleted through its trierarch (decision 0032),
 * Clearing until it confirms; an orphan is shown only. While its trierarch does not answer, everything is its last
 * answer, and the page says so.
 */
export function MachineDetail({ machine, state, spots, location, labels, now, shipNames, clearRequests = [], onClearKept }: MachineDetailProps) {
  if (state === 'loading' || (state === 'ready' && machine === undefined)) {
    return (
      <div aria-busy data-testid="machine-detail" className="flex flex-col gap-4">
        <span className="sr-only">Loading the machine</span>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    );
  }
  if (state === 'not-found' || machine === undefined) {
    return (
      <div data-testid="machine-detail">
        <EmptyState
          variant="section"
          icon={<CircleAlert />}
          title="Machine not found"
          description="The trierarch plugin lists no machine with this ship id. The link may be incomplete."
          action={
            <Button size="sm" nativeButton={false} render={<Link href="/trierarchs" />}>
              Back to Trierarchs
            </Button>
          }
        />
      </div>
    );
  }
  const { details, report } = machine;
  const reportedAt = report === null ? null : new Date(report.reportedAt);
  const isSilent = machine.isSilent && machine.lastSeenAt !== null;
  const asOf = isSilent && reportedAt !== null ? `As of ${clockTime(reportedAt)}` : undefined;
  return (
    <div data-testid="machine-detail" className="flex flex-col gap-5 max-sm:gap-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <h1 className="inline-flex items-center gap-2 text-title font-semibold [&_svg]:size-(--size-icon-lg) [&_svg]:text-muted-foreground">
            <ShipWheel aria-hidden />
            {machine.name}
          </h1>
          <MachineLiveness machine={machine} now={now} />
        </div>
        <Button size="xs" icon={<Ship aria-hidden />} nativeButton={false} render={<Link href={`/ships/${machine.shipId}`} />} data-testid="machine-ship-page">
          Ship page
        </Button>
      </div>
      <dl className="grid grid-cols-5 gap-px overflow-hidden rounded-lg border border-border bg-border max-lg:grid-cols-2">
        <MetaCell label="Capacity">
          <CapacityBar spots={spots} caps={details?.caps} unknownText={reportedAt === null ? 'Unknown until it answers' : `Unknown since ${clockTime(reportedAt)}`} />
        </MetaCell>
        <MetaCell label="Machine">
          <LocationTag kind={location?.kind ?? null} description={location?.description} size="md" />
        </MetaCell>
        <MetaCell label="Version">{details === null ? <span className="text-muted-foreground">Unknown</span> : <span className="font-mono text-id">@aeolus-fleet/trierarch@{details.version}</span>}</MetaCell>
        <MetaCell label="Last answer">
          {reportedAt === null ? (
            <span className="text-muted-foreground">None yet</span>
          ) : (
            <time dateTime={report?.reportedAt} title={fullDateTime(reportedAt)} className="tabular-nums">
              {lastAnswer(reportedAt, now)}
            </time>
          )}
        </MetaCell>
        <MetaCell label="Ship id">
          <span className="truncate font-mono text-id">{machine.shipId}</span>
          <CopyButton value={machine.shipId} label="Copy ship id" />
        </MetaCell>
      </dl>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5" data-testid="machine-labels-row">
        <span className="text-caption font-medium text-muted-foreground">Labels</span>
        {labels === undefined ? <Skeleton className="h-5.5 w-40" /> : <ShipLabels chips={labels} />}
        <span className="text-meta text-muted-foreground">Read-only here. Crew requests that ask for machine labels go only to machines carrying all of them.</span>
      </div>
      {isSilent && machine.lastSeenAt !== null ? (
        <p role="alert" data-testid="machine-silent" className="flex gap-2 rounded-lg border border-tone-attention-border bg-tone-attention-bg px-3.5 py-2.5 text-meta text-tone-attention-fg [&_svg]:mt-0.5 [&_svg]:size-(--size-icon-sm) [&_svg]:shrink-0">
          <CircleX aria-hidden />
          <span>
            <strong className="font-medium">
              {machine.name} has not answered since {clockTime(new Date(machine.lastSeenAt))}.
            </strong>{' '}
            It is probably not running{location?.description ? ` on ${location.description}` : ''}. Until it answers, nothing restarts its sessions; everything below is
            its last answer.
          </span>
        </p>
      ) : null}
      <Section title="Running here" count={spots.length} note={asOf}>
        {spots.length === 0 ? (
          <p className="text-meta text-muted-foreground">No ship is assigned to this trierarch.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card" data-testid="machine-spots">
            {spots.map((spot) => (
              <li key={spot.shipId} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <span className="flex min-w-0 flex-col">
                  <Link href={`/ships/${spot.shipId}`} className="truncate text-body font-medium hover:underline">
                    {spot.name}
                  </Link>
                  {spot.workspace === undefined ? null : (
                    <span className="truncate text-meta text-muted-foreground" data-testid="machine-spot-workspace">
                      <span className="sr-only">Workspace: </span>
                      <span className="font-mono text-id">{spot.workspace.name}</span> · {spot.workspace.kind === 'worktree' ? 'new worktree' : 'folder, as it is'}
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-2.5">
                  <SpotSession spot={spot} now={now} />
                  <StatusBadge status={spot.status} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Harnesses" count={details?.harnesses.length} note={asOf}>
        {details === null ? (
          <p className="text-meta text-muted-foreground">Unknown until it answers.</p>
        ) : (
          <div className="rounded-lg border border-border bg-card px-3.5 py-3">
            {details.harnesses.map((harness) => (
              <HarnessOffer key={harness.harness} harness={harness} now={now} />
            ))}
          </div>
        )}
      </Section>
      <Section title="Workspaces" count={details === null ? undefined : details.workspaces.repositories.length + details.workspaces.folders.length}>
        {details === null ? (
          <p className="text-meta text-muted-foreground">Unknown until it answers.</p>
        ) : (
          <div className="rounded-lg border border-border bg-card px-3.5 py-3">
            <WorkspaceOffer workspaces={details.workspaces} />
          </div>
        )}
      </Section>
      {details === null || (details.kept.length === 0 && details.orphans.length === 0) ? null : (
        <Section title="Worktrees">
          <ul className="divide-y divide-border rounded-lg border border-border bg-card" data-testid="machine-worktrees">
            {details.kept.map((kept) => (
              <KeptRow
                key={`${kept.shipId}/${kept.repository}`}
                kept={kept}
                shipName={shipNames?.get(kept.shipId) ?? kept.shipId}
                isBeingCleared={isClearing(clearRequests, { trierarchShipId: machine.shipId, ...kept })}
                onClear={onClearKept}
              />
            ))}
            {details.orphans.map((orphan) => (
              <WorktreeRow key={`${orphan.repository}/${orphan.name}`} icon={<FolderX aria-hidden />} name={`${orphan.repository}/${orphan.name}`} meta="No crew request" />
            ))}
          </ul>
          <p className="text-meta text-muted-foreground">The trierarch never deletes these on its own.</p>
        </Section>
      )}
    </div>
  );
}
