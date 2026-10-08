import type { LocationKind } from '@aeolus-fleet/common';
import { Bot, CircleDashed, FolderOpen, GitBranch, ShipWheel, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { harnessDetection, harnessWord } from '../../lib/harness';
import { harnessOptions, machineLiveness, type Spot } from '../../lib/machines';
import { clockTime, fullDateTime, lastSeen, relativeTime } from '../../lib/relative-time';
import type { Machine } from '../../lib/trierarch-plugin';
import { Badge } from '../atoms/badge';
import { CapacityBar } from '../molecules/capacity-bar';
import { LocationTag } from '../molecules/location-tag';

interface MachineCardProps {
  machine: Machine;
  /** The ships whose crew requests are assigned to its trierarch. */
  spots: readonly Spot[];
  /** Where its trierarch's session runs, from the fleet. */
  location: { kind: LocationKind; description: string | null } | null;
  now: Date;
}

const LIVENESS_TONES = {
  alive: 'border-tone-ok-border bg-tone-ok-bg text-tone-ok-fg',
  silent: 'border-tone-attention-border bg-tone-attention-bg text-tone-attention-fg',
  'not-started': 'border-tone-waiting-border bg-tone-waiting-bg text-tone-waiting-fg',
} as const;

const LIVENESS_WORDS = { alive: 'Alive', silent: 'Not answering', 'not-started': 'Not started' } as const;

/** Whether its trierarch answers, as a badge with its word, then since when or when it was last seen (canvas TrierarchPlugin, Alive). */
export function MachineLiveness({ machine, now }: { machine: Pick<Machine, 'status' | 'isSilent' | 'lastSeenAt'>; now: Date }) {
  const liveness = machineLiveness(machine);
  const seen = machine.lastSeenAt === null ? null : new Date(machine.lastSeenAt);
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-meta" data-testid="machine-liveness" data-liveness={liveness}>
      <Badge variant="outline" className={LIVENESS_TONES[liveness]}>
        {liveness === 'alive' ? <ShipWheel aria-hidden /> : <CircleDashed aria-hidden />}
        {LIVENESS_WORDS[liveness]}
      </Badge>
      {seen === null ? (
        <span className="text-muted-foreground">· run its setup line on the machine</span>
      ) : (
        <time dateTime={machine.lastSeenAt ?? undefined} title={fullDateTime(seen)} className="text-muted-foreground tabular-nums">
          · {liveness === 'silent' ? `since ${clockTime(seen)}` : lastSeen(seen, now).replace('Last seen', 'seen')}
        </time>
      )}
    </span>
  );
}

/** "12 min ago", "just now" or "28 Sep, 14:21", after "Last answer". */
export function lastAnswer(at: Date, now: Date): string {
  const relative = relativeTime(at, now);
  return relative === 'Just now' ? 'just now' : relative;
}

function Column({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={`flex min-w-0 flex-col gap-2 px-4.5 py-4 ${className ?? ''}`}>
      <span className="text-caption font-medium text-muted-foreground">{title}</span>
      {children}
    </div>
  );
}

/**
 * A harness the machine offers: its version and when its models were last
 * confirmed (#365), its options' values, its default marked, and
 * the flags every launch gets, each flag its trierarch reports as risky marked
 * in the waiting tone (#326).
 */
export function HarnessOffer({ harness, now }: { harness: NonNullable<Machine['details']>['harnesses'][number]; now: Date }) {
  const detection = harnessDetection(harness, now);
  return (
    <div className="flex flex-col gap-1.5 border-t border-border py-2.5 first-of-type:border-t-0 first-of-type:pt-0">
      <span className="inline-flex items-center gap-1.5 text-body font-medium [&_svg]:size-(--size-icon-sm) [&_svg]:text-muted-foreground">
        <Bot aria-hidden />
        {harnessWord(harness.harness)}
        {detection === undefined ? null : <span className="font-normal text-meta text-muted-foreground">{detection}</span>}
      </span>
      {harnessOptions(harness.options).map((option) => (
        <span key={option.name} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-meta">
          <span className="text-muted-foreground">{option.name}</span>
          {option.values.map((value) => (
            <span key={value} className="font-mono text-id whitespace-nowrap">
              {value}
              {value === option.defaultValue ? <span className="font-sans text-muted-foreground"> (default)</span> : null}
            </span>
          ))}
        </span>
      ))}
      {harness.flags.length === 0 ? null : (
        <span className="flex flex-wrap items-center gap-1.5">
          {harness.flags.map((flag) =>
            harness.riskyFlags?.includes(flag) === true ? (
              <code
                key={flag}
                data-testid="machine-risky-flag"
                title="Risky: every launch runs without its harness's safeguards"
                className="inline-flex items-center gap-1 rounded-sm border border-tone-waiting-border bg-tone-waiting-bg px-1.5 font-mono text-id text-tone-waiting-fg [&_svg]:size-(--size-icon-sm)"
              >
                <TriangleAlert aria-hidden />
                {flag}
                <span className="sr-only"> (risky)</span>
              </code>
            ) : (
              <code key={flag} className="rounded-sm bg-muted px-1.5 font-mono text-id">
                {flag}
              </code>
            ),
          )}
        </span>
      )}
    </div>
  );
}

function WorkspaceGroup({ title, icon, names }: { title: string; icon: ReactNode; names: readonly string[] }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-caption text-muted-foreground">{title}</span>
      {names.length === 0 ? (
        <span className="text-meta text-muted-foreground">None</span>
      ) : (
        names.map((name) => (
          <span key={name} className="inline-flex items-center gap-1.5 text-meta [&_svg]:size-(--size-icon-sm) [&_svg]:shrink-0 [&_svg]:text-muted-foreground">
            {icon}
            {name}
          </span>
        ))
      )}
    </div>
  );
}

/** The workspaces a machine offers: repositories, each ship a new worktree, and folders, used as they are. */
export function WorkspaceOffer({ workspaces }: { workspaces: NonNullable<Machine['details']>['workspaces'] }) {
  return (
    <div className="flex flex-col gap-3">
      <WorkspaceGroup title="Repositories · a new worktree per ship" icon={<GitBranch aria-hidden />} names={workspaces.repositories} />
      <WorkspaceGroup title="Folders · used as they are" icon={<FolderOpen aria-hidden />} names={workspaces.folders} />
    </div>
  );
}

/**
 * One machine in the Trierarchs list (canvas TrierarchPlugin, MachineCard):
 * its trierarch as a link to the machine's page, whether it answers, where it
 * runs and its version, its capacity, the harnesses it offers with their
 * options and flags, and its workspaces. Until it reported, what it offers is
 * unknown.
 */
export function MachineCard({ machine, spots, location, now }: MachineCardProps) {
  const { details, report } = machine;
  const reportedAt = report === null ? null : new Date(report.reportedAt);
  return (
    <section
      aria-label={machine.name}
      data-testid="machine-card"
      className="grid grid-cols-[minmax(0,18.75rem)_minmax(0,1.25fr)_minmax(0,1fr)] divide-x divide-border rounded-lg border border-border bg-card shadow-sm max-lg:grid-cols-1 max-lg:divide-x-0 max-lg:divide-y"
    >
      <div className="flex min-w-0 flex-col gap-2.5 px-4.5 py-4">
        <Link
          href={`/trierarchs/${machine.shipId}`}
          data-testid="machine-card-name"
          className="inline-flex items-center gap-2 text-section font-semibold hover:underline [&_svg]:size-(--size-icon) [&_svg]:text-muted-foreground"
        >
          <ShipWheel aria-hidden />
          {machine.name}
        </Link>
        <MachineLiveness machine={machine} now={now} />
        <span className="flex flex-wrap items-center gap-1.5 text-meta text-muted-foreground">
          <LocationTag kind={location?.kind ?? null} description={location?.description} />
          {details === null ? null : <span className="font-mono text-id">· trierarch {details.version}</span>}
        </span>
        <div role="separator" className="h-px bg-border" />
        <span className="text-caption font-medium text-muted-foreground">Capacity</span>
        <CapacityBar spots={spots} caps={details?.caps} testId="machine-card-capacity" unknownText={reportedAt === null ? 'Unknown until it answers' : `Unknown since ${clockTime(reportedAt)}`} />
        {reportedAt === null ? null : (
          <time dateTime={report?.reportedAt} title={fullDateTime(reportedAt)} className="text-meta text-muted-foreground">
            Last answer {lastAnswer(reportedAt, now)}
          </time>
        )}
      </div>
      <Column title="Harnesses, options and flags">
        {details === null ? <span className="text-meta text-muted-foreground">Unknown until it answers</span> : details.harnesses.map((harness) => <HarnessOffer key={harness.harness} harness={harness} now={now} />)}
      </Column>
      <Column title="Workspaces">
        {details === null ? <span className="text-meta text-muted-foreground">Unknown until it answers</span> : <WorkspaceOffer workspaces={details.workspaces} />}
      </Column>
    </section>
  );
}
