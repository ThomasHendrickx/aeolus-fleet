import type { Health } from '@aeolus-fleet/common';
import type { ReactNode } from 'react';

import { InlineError } from '../../../../components/molecules/inline-error';
import { LoadingSkeleton } from '../../../../components/molecules/loading-skeleton';
import { causeGroupsOf, stuckByMachine, type StuckPlace } from '../../services/health-view';
import { CauseCard } from './cause-card';
import { DeliveringLine } from './delivering-line';
import { HealthVerdict } from './health-verdict';
import { MachinesPanel, type HealthMachine } from './machines-panel';

interface HealthBoardProps {
  state: 'loading' | 'error' | 'ready';
  health: Health | undefined;
  onRetry: () => void;
  notes: ReadonlyMap<StuckPlace, string>;
  /** The machines, when the trierarch plugin is connected; none to leave the section out. */
  machines?: readonly HealthMachine[];
  renderLiveness: (machine: HealthMachine) => ReactNode;
  /** More sections after the machines, such as silent squadron members. */
  children?: ReactNode;
  now: Date;
}

/**
 * The Health page's content (mock-up A), top to bottom: the verdict with its
 * trend, the delivering line, a card per cause with anything stuck, the
 * machines. Nothing stuck is its good state: the verdict says Delivering and
 * no cards show. Loading keeps the page's shape; an error keeps the chrome.
 */
export function HealthBoard({ state, health, onRetry, notes, machines, renderLiveness, children, now }: HealthBoardProps) {
  if (state === 'error') {
    return (
      <InlineError
        variant="page"
        title="Couldn’t load the fleet’s health"
        description="Nothing changed in the fleet. The page tries again by itself."
        onRetry={onRetry}
      />
    );
  }
  if (state === 'loading' || health === undefined) {
    return <LoadingSkeleton variant="cards" rows={4} label="Loading the fleet’s health" />;
  }
  const groups = causeGroupsOf(health);
  return (
    <div data-testid="health-board" className="flex flex-col gap-5 max-sm:gap-3.5">
      <HealthVerdict health={health} />
      <DeliveringLine acknowledged={health.acknowledged} />
      {groups.length > 0 && (
        <div className="grid gap-5 lg:grid-cols-2 max-sm:gap-3.5">
          {groups.map((group) => (
            <CauseCard key={group.cause} group={group} notes={notes} now={now} />
          ))}
        </div>
      )}
      {machines !== undefined && machines.length > 0 && <MachinesPanel machines={machines} stuckByMachine={stuckByMachine(health)} renderLiveness={renderLiveness} />}
      {children}
    </div>
  );
}
