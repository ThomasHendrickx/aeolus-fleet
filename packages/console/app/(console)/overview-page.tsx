'use client';

import { KeyRound, Lock, Tag } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { startTransition, useOptimistic, useState } from 'react';

import { Button } from '@aeolus-fleet/common/header';
import { ComposeMessage } from '../../features/compose/organisms/compose-message';
import { OverviewMetrics } from '../../features/fleet/state/overview-metrics';
import { CommissionShip } from '../../features/fleet/state/commission-ship';
import { FleetLimits } from '../../features/fleet/state/fleet-limits';
import { FleetOverview } from '../../features/fleet/state/fleet-overview';
import { KeyNotReachable } from '../../features/sealing/state/key-not-reachable';
import { ShipActions } from '../../features/ship-actions/organisms/ship-actions';
import { NewCrewLineFlow } from '../../features/squadrons/state/get-new-crew-line';
import { LimitNotice } from '../../components/molecules/limit-notice';
import { ListPage } from '../../components/organisms/list-page';
import { useConsoleFrame } from '../../lib/console-frame';
import { FleetSegments } from '../../components/molecules/fleet-segments';
import { useAccess } from '../../lib/access';
import { useFleetLimits } from '../../lib/fleet-limits';
import { useHostedAccountUrl } from '../../lib/hosted-account';
import { messageLimitNotice, messageLimitReached } from '../../lib/limits';
import { useShipCounts } from '../../lib/ship-counts';
import { fleetViewParams, type FleetView } from '../../features/fleet/services/fleet-filter';
import { useLiveFleet } from '../../lib/live-fleet';
import { overviewSubtitle } from '../../features/fleet/services/overview-metrics';
import { useSignInWhenSessionEnds } from '../../lib/session';
import { usePluginNav } from '../../lib/plugin-nav';

/**
 * The fleet overview, live: every ship with its status, where it runs and its
 * actions, updated as the fleet changes, without a reload. Search and filters
 * live in the URL, read on the web app's server (page.tsx); while the URL
 * changes, the view shows what was picked already, so a second pick right
 * after the first adds to it (#815). Without a session it sends the operator
 * to sign in.
 */
export function OverviewPage({ view, isCommissionAsked }: { view: FleetView; isCommissionAsked: boolean }) {
  const router = useRouter();
  const counts = useShipCounts();
  const liveFleet = useLiveFleet();
  const frame = useConsoleFrame();
  const messageLimit = messageLimitReached(useFleetLimits().data);
  const accountUrl = useHostedAccountUrl();
  const access = useAccess();
  const pluginNav = usePluginNav();
  const [isCommissioning, setIsCommissioning] = useState(false);
  const [shownView, setShownView] = useOptimistic(view);
  useSignInWhenSessionEnds([counts.error, liveFleet.error]);

  const changeView = (next: FleetView) => {
    const params = fleetViewParams(next).toString();
    startTransition(() => {
      setShownView(next);
      router.replace(params === '' ? '/' : `/?${params}`, { scroll: false });
    });
  };

  return (
    <ListPage
      {...frame}
      title="Fleet overview"
      description={counts.data ? overviewSubtitle({ counts: counts.data, canCommission: access.canManage }) : 'Loading your fleet'}
      primaryAction={
        <div className="flex flex-wrap items-center gap-2 max-sm:flex-col max-sm:items-stretch">
          <Button render={<Link href="/labels" />} nativeButton={false} icon={<Tag />} data-testid="overview-labels">
            {access.canDefineLabels ? 'Manage labels' : 'View labels'}
          </Button>
          <Button render={<Link href="/scopes" />} nativeButton={false} icon={<KeyRound />} data-testid="overview-scopes">
            {access.canDefineScopes ? 'Manage scopes' : 'View scopes'}
          </Button>
          <Button render={<Link href="/sealing" />} nativeButton={false} icon={<Lock />} data-testid="overview-sealing">
            {access.canChangeKeys ? 'Manage sealing' : 'View sealing'}
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
      <KeyNotReachable />
      <FleetLimits />
      <OverviewMetrics />
      <FleetOverview
        view={shownView}
        onViewChange={changeView}
        placedFirstShipIds={liveFleet.placedFirstShipIds}
        renderRowActions={(ship, layout) => (
          <ShipActions ship={ship} layout={layout === 'table' ? 'menu' : layout === 'phone' ? 'sheet' : 'next'} compose={ComposeMessage} crewLineFlow={NewCrewLineFlow} />
        )}
      />
    </ListPage>
  );
}
