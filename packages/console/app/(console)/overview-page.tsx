'use client';

import { Tag } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '../../components/atoms/button';
import { ComposeMessage } from '../../features/compose/organisms/compose-message';
import { OverviewMetrics } from '../../features/fleet/organisms/overview-metrics';
import { CommissionShip } from '../../features/fleet/organisms/commission-ship';
import { FleetLimits } from '../../features/fleet/organisms/fleet-limits';
import { FleetOverview } from '../../features/fleet/organisms/fleet-overview';
import { ShipActions } from '../../features/ship-actions/organisms/ship-actions';
import { NewCrewLineFlow } from '../../features/squadrons/organisms/get-new-crew-line';
import { LimitNotice } from '../../components/molecules/limit-notice';
import { ListPage } from '../../components/organisms/list-page';
import { useConsoleFrame } from '../../lib/console-frame';
import { FleetSegments } from '../../components/molecules/fleet-segments';
import { useAccess } from '../../lib/access';
import { useFleetLimits } from '../../lib/fleet-limits';
import { useHostedAccountUrl } from '../../lib/hosted-account';
import { messageLimitNotice, messageLimitReached } from '../../lib/limits';
import { useFleetSnapshot } from '../../lib/fleet';
import { fleetViewParams, type FleetView } from '../../features/fleet/lib/fleet-filter';
import { useLiveFleet } from '../../lib/live-fleet';
import { overviewSubtitle } from '../../features/fleet/lib/overview-metrics';
import { useSignInWhenSessionEnds } from '../../lib/session';
import { usePluginNav } from '../../lib/plugin-nav';

/**
 * The fleet overview, live: every ship with its status, where it runs and its
 * actions, updated as the fleet changes, without a reload. Search and filters
 * live in the URL, read on the web app's server (page.tsx). Without a session
 * it sends the operator to sign in.
 */
export function OverviewPage({ view, isCommissionAsked }: { view: FleetView; isCommissionAsked: boolean }) {
  const router = useRouter();
  const fleet = useFleetSnapshot();
  const liveFleet = useLiveFleet();
  const frame = useConsoleFrame();
  const messageLimit = messageLimitReached(useFleetLimits().data);
  const accountUrl = useHostedAccountUrl();
  const access = useAccess();
  const pluginNav = usePluginNav();
  const [isCommissioning, setIsCommissioning] = useState(false);
  useSignInWhenSessionEnds([fleet.error, liveFleet.error]);

  const changeView = (next: FleetView) => {
    const params = fleetViewParams(next).toString();
    router.replace(params === '' ? '/' : `/?${params}`, { scroll: false });
  };

  return (
    <ListPage
      {...frame}
      title="Fleet overview"
      description={fleet.data ? overviewSubtitle({ ships: fleet.data, canCommission: access.canManage }) : 'Loading your fleet'}
      primaryAction={
        <div className="flex flex-wrap items-center gap-2 max-sm:flex-col max-sm:items-stretch">
          <Button render={<Link href="/labels" />} nativeButton={false} icon={<Tag />} data-testid="overview-labels">
            {access.canDefineLabels ? 'Manage labels' : 'View labels'}
          </Button>
          {access.canManage ? (
            <CommissionShip
              isOpen={isCommissioning || isCommissionAsked}
              onOpenChange={(isOpen) => {
                setIsCommissioning(isOpen);
                if (!isOpen && isCommissionAsked) {
                  changeView(view);
                }
              }}
            />
          ) : null}
        </div>
      }
      live={liveFleet.live}
    >
      <FleetSegments active="ships" needsCrewCount={pluginNav.needsCrewCount} />
      {messageLimit === undefined ? null : <LimitNotice {...messageLimitNotice(messageLimit)} accountUrl={accountUrl} testId="overview-message-limit" />}
      <FleetLimits />
      <OverviewMetrics />
      <FleetOverview
        view={view}
        onViewChange={changeView}
        newShipIds={liveFleet.newShipIds}
        renderRowActions={(ship, layout) => (
          <ShipActions ship={ship} layout={layout === 'table' ? 'menu' : layout === 'phone' ? 'sheet' : 'next'} compose={ComposeMessage} crewLineFlow={NewCrewLineFlow} />
        )}
      />
    </ListPage>
  );
}
