'use client';

import type { StuckCause } from '@aeolus-fleet/common';

import { DetailPage } from '../../../../components/organisms/detail-page';
import { StatusBadge, statusLabel } from '../../../../components/molecules/status-badge';
import { DrilldownContainer } from '../../../../features/health/state/drilldown-container';
import { useConsoleFrame } from '../../../../lib/console-frame';
import { useStuckSummary } from '../../../../lib/fleet-health';
import { useLiveFleet } from '../../../../lib/live-fleet';
import { useSignInWhenSessionEnds } from '../../../../lib/session';

/** One cause of Health opened, live: its places and their deliveries one by one, under Health. */
export function CausePage({ cause }: { cause: StuckCause }) {
  const frame = useConsoleFrame();
  const liveFleet = useLiveFleet();
  const summary = useStuckSummary();
  useSignInWhenSessionEnds([summary.error, liveFleet.error]);
  const count = summary.data && (summary.data.byCause.find((total) => total.cause === cause)?.count ?? 0);

  return (
    <DetailPage
      switcher={frame.switcher}
      account={frame.account}
      onCompose={frame.onCompose}
      onSearch={frame.onSearch}
      banner={frame.banner}
      title={statusLabel(cause)}
      parents={[{ href: '/fleet-health', label: 'Health' }]}
      live={liveFleet.live}
      header={
        <div className="flex flex-wrap items-center gap-3" data-testid="drilldown-header">
          <StatusBadge status={cause} />
          {count === undefined ? null : (
            <p className="text-section font-semibold text-foreground">
              {count} {count === 1 ? 'delivery' : 'deliveries'} stuck
            </p>
          )}
        </div>
      }
    >
      <DrilldownContainer cause={cause} />
    </DetailPage>
  );
}
