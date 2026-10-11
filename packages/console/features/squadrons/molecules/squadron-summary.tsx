import type { ReportState } from '@aeolus-fleet/common';
import type { ReactNode } from 'react';

import type { MemberHealth } from '../../../lib/squadron-states';
import { HealthSummary } from '../../../components/molecules/health-indicator';

const WORK_WORDS: Record<ReportState, string> = { working: 'working', idle: 'idle', blocked: 'blocked' };

interface SquadronSummaryProps {
  health: readonly { health: MemberHealth; count: number }[];
  work: readonly { state: ReportState; count: number }[];
  /** Deliveries pending or in flight in the members' inboxes; unknown until every member's ship is read. */
  openDeliveries: number | undefined;
  /** How many messages the flagship kept; unknown until they are read. */
  keptCount: number | undefined;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-caption font-medium text-muted-foreground">{label}</span>
      <span className="text-meta text-foreground">{children}</span>
    </div>
  );
}

/**
 * A squadron at a glance (canvas, SqSailing): its members' health and the
 * work they report, the deliveries open in their inboxes, and what the
 * flagship kept. "None" where there is nothing, "…" while not known yet.
 */
export function SquadronSummary({ health, work, openDeliveries, keptCount }: SquadronSummaryProps) {
  return (
    <div
      aria-label="Squadron summary"
      data-testid="squadron-summary"
      className="grid grid-cols-4 gap-4 rounded-lg border border-border bg-card px-4 py-3 shadow-sm max-sm:grid-cols-2 max-sm:gap-3"
    >
      <Fact label="Health">{health.length === 0 ? 'None' : <HealthSummary counts={health} />}</Fact>
      <Fact label="Work">
        {work.length === 0 ? 'None reported' : work.map(({ state, count }) => `${String(count)} ${WORK_WORDS[state]}`).join(', ')}
      </Fact>
      <Fact label="Open deliveries">{openDeliveries === undefined ? '…' : `${String(openDeliveries)} in member inboxes`}</Fact>
      <Fact label="Kept by the flagship">{keptCount === undefined ? '…' : keptCount === 0 ? 'None' : String(keptCount)}</Fact>
    </div>
  );
}
