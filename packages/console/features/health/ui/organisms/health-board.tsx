import type { Health } from '@aeolus-fleet/common';
import type { ReactNode } from 'react';

import { classNames } from '@aeolus-fleet/common/header';
import { Skeleton } from '../../../../components/atoms/skeleton';
import { InlineError } from '../../../../components/molecules/inline-error';
import { causeGroupsOf, stuckByMachine, type StuckPlace } from '../../services/health-view';
import { CauseCard } from './cause-card';
import { DeliveringLine } from './delivering-line';
import { HealthVerdict } from './health-verdict';
import { MachinesPanel, type HealthMachine } from './machines-panel';

/** One read the board shows: its data once read, whether it failed, and how to read it again. */
export interface HealthPartRead<T> {
  data: T | undefined;
  isError: boolean;
  onRetry: () => void;
}

interface HealthBoardProps {
  /** Where deliveries are stuck now: the verdict, the cause cards and the machines' counts. */
  stuck: HealthPartRead<Health['stuck']>;
  /** The 7-day trend: the verdict's trend and its day-ago comparison. */
  stuckPerHour: HealthPartRead<Health['stuckPerHour']>;
  /** The delivering line. */
  acknowledged: HealthPartRead<Health['acknowledged']>;
  notes: ReadonlyMap<StuckPlace, string>;
  /** The machines, when the trierarch plugin is connected; none to leave the section out. */
  machines?: readonly HealthMachine[];
  renderLiveness: (machine: HealthMachine) => ReactNode;
  /** More sections after the machines, such as silent squadron members. */
  children?: ReactNode;
  now: Date;
}

/** A part still being read, in the shape of what is coming. */
function PartLoading({ label, className }: { label: string; className: string }) {
  return (
    <div role="status" data-testid="health-part-loading">
      <span className="sr-only">{label}</span>
      <Skeleton className={classNames('w-full rounded-lg', className)} />
    </div>
  );
}

/**
 * The Health page's content (mock-up A), top to bottom: the verdict with its
 * trend, the delivering line, a card per cause with anything stuck, the
 * machines. Nothing stuck is its good state: the verdict says Delivering and
 * no cards show. Each part shows as soon as its own read is in, and loads or
 * fails on its own (performance design, decision 2): the verdict waits for
 * the stuck places and the trend, the delivering line for the acknowledged,
 * the cause cards and the machines for the stuck places. A failed read of the
 * stuck places is said once, at the verdict.
 */
export function HealthBoard({ stuck, stuckPerHour, acknowledged, notes, machines, renderLiveness, children, now }: HealthBoardProps) {
  const groups = stuck.data === undefined ? undefined : causeGroupsOf({ stuck: stuck.data });
  return (
    <div data-testid="health-board" className="flex flex-col gap-5 max-sm:gap-3.5">
      {stuck.isError || stuckPerHour.isError ? (
        <InlineError
          title="Couldn’t load where deliveries are stuck"
          description="Nothing changed in the fleet. The page tries again by itself."
          onRetry={() => {
            for (const read of [stuck, stuckPerHour]) {
              if (read.isError) {
                read.onRetry();
              }
            }
          }}
        />
      ) : stuck.data === undefined || stuckPerHour.data === undefined ? (
        <PartLoading label="Loading the verdict" className="h-44" />
      ) : (
        <HealthVerdict health={{ stuck: stuck.data, stuckPerHour: stuckPerHour.data }} />
      )}
      {acknowledged.isError ? (
        <InlineError title="Couldn’t load the deliveries acknowledged" description="Nothing changed in the fleet. The page tries again by itself." onRetry={acknowledged.onRetry} />
      ) : acknowledged.data === undefined ? (
        <PartLoading label="Loading the deliveries acknowledged" className="h-16" />
      ) : (
        <DeliveringLine acknowledged={acknowledged.data} />
      )}
      {groups === undefined ? (
        stuck.isError ? null : <PartLoading label="Loading where deliveries are stuck" className="h-40" />
      ) : (
        groups.length > 0 && (
          <div className="grid gap-5 lg:grid-cols-2 max-sm:gap-3.5">
            {groups.map((group) => (
              <CauseCard key={group.cause} group={group} notes={notes} now={now} />
            ))}
          </div>
        )
      )}
      {stuck.data !== undefined && machines !== undefined && machines.length > 0 && (
        <MachinesPanel machines={machines} stuckByMachine={stuckByMachine({ stuck: stuck.data })} renderLiveness={renderLiveness} />
      )}
      {children}
    </div>
  );
}
