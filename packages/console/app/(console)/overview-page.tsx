'use client';

import { Button } from '@aeolus-fleet/ui';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { startTransition, useOptimistic, useState } from 'react';

import { ComposeMessage } from '../../features/compose/organisms/compose-message';
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
import { useAccess, useIsFeatureOn } from '../../lib/access';
import { useFleetLimits } from '../../lib/fleet-limits';
import { useHostedAccountUrl } from '../../lib/hosted-account';
import { messageLimitNotice, messageLimitReached } from '../../lib/limits';
import { fleetViewParams, type FleetView } from '../../features/fleet/services/fleet-filter';
import { sealingEntryOf } from '../../features/fleet/services/sealing-entry';
import { OverviewActions } from '../../features/fleet/ui/molecules/overview-actions';
import { useLiveFleet } from '../../lib/live-fleet';
import { harbourSummaryOf } from '../../features/fleet/services/harbour';
import { useHarbourNumbers } from '../../features/fleet/hooks/harbour';
import { useSignInWhenSessionEnds } from '../../lib/session';
import { usePluginNav } from '../../lib/plugin-nav';

/**
 * The fleet overview, live (docs/design/fleet-overview, "One view: cards or
 * list"): Harbour's numbers, one bar, and Harbour's cards or the fleet table,
 * updated as the fleet changes, without a reload. The view, search and
 * filters live in the address, read on the web app's server (page.tsx);
 * while the address changes, the view shows what was picked already, so a
 * second pick right after the first adds to it (#815). Without a session it
 * sends the operator to sign in.
 */
export function OverviewPage({ view, isCommissionAsked }: { view: FleetView; isCommissionAsked: boolean }) {
  const router = useRouter();
  const numbers = useHarbourNumbers();
  const liveFleet = useLiveFleet();
  const frame = useConsoleFrame();
  const messageLimit = messageLimitReached(useFleetLimits().data);
  const accountUrl = useHostedAccountUrl();
  const access = useAccess();
  const isSealingOn = useIsFeatureOn('sealing');
  const pluginNav = usePluginNav();
  const [isCommissioning, setIsCommissioning] = useState(false);
  const [shownView, setShownView] = useOptimistic(view);
  useSignInWhenSessionEnds([numbers.error, liveFleet.error]);

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
      description={numbers.counts ? harbourSummaryOf(numbers.counts, { canCommission: access.canManage }) : 'Loading your fleet'}
      primaryAction={
        <OverviewActions
          canDefineLabels={access.canDefineLabels}
          canDefineScopes={access.canDefineScopes}
          sealing={sealingEntryOf({ isSealingOn, canChangeKeys: access.canChangeKeys })}
          commission={
            access.canManage ? (
              <CommissionShip
                isOpen={isCommissioning || isCommissionAsked}
                onOpenChange={(isOpen) => {
                  setIsCommissioning(isOpen);
                  if (!isOpen && isCommissionAsked) {
                    changeView(view);
                  }
                }}
              />
            ) : null
          }
        />
      }
      live={liveFleet.live}
    >
      <FleetSegments active="ships" needsCrewCount={pluginNav.needsCrewCount} />
      {messageLimit === undefined ? null : <LimitNotice {...messageLimitNotice(messageLimit)} accountUrl={accountUrl} testId="overview-message-limit" />}
      <KeyNotReachable />
      <FleetLimits />
      <FleetOverview
        view={shownView}
        onViewChange={changeView}
        placedFirstShipIds={liveFleet.placedFirstShipIds}
        emptyAction={
          access.canManage ? (
            <Button
              variant="primary"
              icon={<Plus />}
              data-testid="overview-commission-first"
              onClick={() => {
                setIsCommissioning(true);
              }}
            >
              Commission your first ship
            </Button>
          ) : null
        }
        renderRowActions={(ship, layout) => (
          <ShipActions ship={ship} layout={layout === 'table' ? 'menu' : layout === 'phone' ? 'sheet' : 'next'} compose={ComposeMessage} crewLineFlow={NewCrewLineFlow} />
        )}
      />
    </ListPage>
  );
}
