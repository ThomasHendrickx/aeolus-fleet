import Link from 'next/link';

import { shortDateTime } from '../../lib/relative-time';
import type { Squadron } from '../../lib/squadrons-api';
import { blueprintPath, stationCount } from '../../lib/squadrons-view';
import { EmptyState } from '../molecules/empty-state';
import { LoadingSkeleton } from '../molecules/loading-skeleton';
import { StationProgress } from '../molecules/station-progress';
import { StatusBadge } from '../molecules/status-badge';

interface SquadronHeaderProps {
  squadron: Squadron | undefined;
  /** The id the page was opened with, named when no such squadron exists. */
  squadronId: string;
  state: 'ready' | 'loading' | 'not-found';
}

/**
 * Top of the squadron page (docs/design/png/SquadronHeader.png): its name,
 * state and blueprint version, and a meta strip with the flagship, members
 * and when it was formed. While Forming, how many members are on station.
 */
export function SquadronHeader({ squadron, squadronId, state }: SquadronHeaderProps) {
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
      {squadron.state === 'forming' && <StationProgress done={onStation} total={total} variant="forming" className="max-w-md" />}
    </header>
  );
}
