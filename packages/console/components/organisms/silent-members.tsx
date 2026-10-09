import type { ListedShip } from '@aeolus-fleet/common';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { duration } from '../../lib/relative-time';
import type { Squadron } from '../../lib/squadrons-schemas';
import { checkInText } from '../../lib/squadrons-view';
import { HealthIndicator } from '../molecules/health-indicator';
import { ReportLine } from '../molecules/report-line';
import { SquadronTag } from '../molecules/squadron-tag';

interface SilentMembersProps {
  members: readonly { squadronId: string; member: Squadron['members'][number] }[];
  /** Each member's ship as the fleet lists it, by ship id: its last report. */
  ships: ReadonlyMap<string, ListedShip>;
  now: Date;
  /** A member's action before Open: Get new crew line, the primary action for a silent member. */
  renderAction?: (silent: { squadronId: string; member: Squadron['members'][number] }) => ReactNode;
}

/**
 * The silent squadron members (docs/design/png/NeedsAttentionList.png): three
 * missed check-ins. Each with its squadron and role, how long it has not been
 * seen against its check-in interval, its last report, the action the page
 * gives it (Get new crew line), and Open to its squadron. Late members and blocked reports stay on the squadron page.
 */
export function SilentMembers({ members, ships, now, renderAction }: SilentMembersProps) {
  return (
    <ul data-testid="silent-members" className="divide-y divide-border overflow-hidden rounded-lg border border-border">
      {members.map(({ squadronId, member }) => {
        const { lastSeenAt } = member.crew;
        return (
          <li key={member.shipId} data-testid="silent-member" className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2.5">
            <span className="flex min-w-0 flex-col gap-1">
              <span className="flex items-center gap-2">
                <HealthIndicator health="silent" />
                <span className="font-medium">{member.name}</span>
              </span>
              <SquadronTag squadronId={squadronId} role={member.role} size="sm" />
            </span>
            <span className="flex flex-col text-meta">
              <span>{lastSeenAt === null ? 'never seen' : `not seen for ${duration(new Date(lastSeenAt), now)}`}</span>
              <span className="text-muted-foreground">checks in {checkInText(member.checkInMinutes)}</span>
            </span>
            <span className="grow">
              <ReportLine report={ships.get(member.shipId)?.report ?? null} now={now} variant="row" testId="silent-member-report" />
            </span>
            {renderAction?.({ squadronId, member })}
            <Link href={`/squadrons/${squadronId}`} className="inline-flex items-center gap-1 text-meta font-medium hover:underline">
              Open
              <ChevronRight aria-hidden className="size-(--size-icon-sm)" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
