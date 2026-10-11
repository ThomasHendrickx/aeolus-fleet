import Link from 'next/link';
import type { ReactNode } from 'react';

import { shortDateTime } from '../../../lib/relative-time';
import type { Squadron } from '../../../lib/squadrons-schemas';
import { blueprintPath, stationCount } from '../../../lib/squadrons-view';
import { Button } from '../../../components/atoms/button';
import { EmptyState } from '../../../components/molecules/empty-state';
import { LoadingSkeleton } from '../../../components/molecules/loading-skeleton';
import { StationProgress } from '../molecules/station-progress';
import { StatusBadge } from '../../../components/molecules/status-badge';

interface SquadronHeaderProps {
  squadron: Squadron | undefined;
  /** The id the page was opened with, named when no such squadron exists. */
  squadronId: string;
  state: 'ready' | 'loading' | 'not-found';
  /** The actions its state allows: Stand down while Sailing; none once Disbanded. */
  actions?: ReactNode;
  /** Force stand down from the Standing down notice; none for a session that may not manage the fleet. */
  onForceStandDown?: () => void;
}

function disbandedWords(members: number): string {
  return members === 1 ? '1 member ship' : `${String(members)} member ships`;
}

/**
 * Top of the squadron page (docs/design/png/SquadronHeader.png): its name,
 * state and blueprint version, and a meta strip with the flagship, members
 * and when it was formed, and the actions its state allows. While Forming,
 * how many members are on station; while Standing down, what that means,
 * Force stand down and how many finished; once Disbanded, that it is
 * read-only (canvas SqForming, SqStanding, SqDisbanded).
 */
export function SquadronHeader({ squadron, squadronId, state, actions, onForceStandDown }: SquadronHeaderProps) {
  if (state === 'loading') {
    return <LoadingSkeleton variant="detail" rows={2} label="Loading the squadron" />;
  }
  if (state === 'not-found' || !squadron) {
    return <EmptyState title="No such squadron" description={`The squadron manager knows no squadron ${squadronId}.`} />;
  }
  const { onStation, total } = stationCount(squadron);
  return (
    <header data-testid="squadron-header" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <h1 className="text-title font-semibold">{squadron.id}</h1>
        <StatusBadge status={squadron.state} />
        <Link href={blueprintPath(squadron.blueprint)} className="text-meta text-muted-foreground hover:underline" data-testid="squadron-blueprint">
          <span className="font-mono">{squadron.blueprint.name}</span> v{squadron.blueprint.version}
        </Link>
        {actions && <div className="ml-auto flex gap-2">{actions}</div>}
      </div>
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-meta text-muted-foreground">
        <div className="flex gap-1.5">
          <dt>Flagship</dt>
          <dd className="font-mono text-foreground">{squadron.flagship.name}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt>Members</dt>
          <dd className="text-foreground">{total}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt>Formed</dt>
          <dd className="text-foreground">{shortDateTime(new Date(squadron.formedAt))}</dd>
        </div>
      </dl>
      {squadron.state === 'standing-down' && (
        <div role="status" data-testid="squadron-state-notice" className="flex flex-wrap items-center gap-3 rounded-lg border border-tone-waiting-border bg-tone-waiting-bg px-3 py-2.5 text-meta text-foreground">
          <span className="grow">No new work reaches its members. They finish their open work, then retire and the squadron disbands.</span>
          {onForceStandDown && (
            <Button size="xs" data-testid="squadron-notice-force-stand-down" onClick={onForceStandDown}>
              Force stand down…
            </Button>
          )}
        </div>
      )}
      {squadron.state === 'disbanded' && (
        <div role="status" data-testid="squadron-state-notice" className="rounded-lg border border-tone-ended-border bg-tone-ended-bg px-3 py-2.5 text-meta text-foreground">
          Read-only. Its {disbandedWords(total)} and its flagship were retired; their history stays.
        </div>
      )}
      {squadron.state === 'forming' && <StationProgress done={onStation} total={total} variant="forming" className="max-w-md" />}
      {squadron.state === 'standing-down' && (
        <StationProgress done={squadron.members.filter((member) => member.crew.status === 'retired').length} total={total} variant="standdown" className="max-w-md" />
      )}
    </header>
  );
}
