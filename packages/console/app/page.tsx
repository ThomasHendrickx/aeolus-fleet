'use client';

import { Tag } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useState } from 'react';

import { Button } from '../components/atoms/button';
import { ComposeMessage } from '../components/organisms/compose-message';
import { ConsoleCommands } from '../components/organisms/console-commands';
import { ConsoleGuide } from '../components/organisms/console-guide';
import { ConsoleNotices } from '../components/organisms/console-notices';
import { OverviewMetrics } from '../components/organisms/overview-metrics';
import { CommissionShip } from '../components/organisms/commission-ship';
import { FleetLimits } from '../components/organisms/fleet-limits';
import { FleetOverview } from '../components/organisms/fleet-overview';
import { LimitNotice } from '../components/molecules/limit-notice';
import { ListLayout } from '../components/templates/list-layout';
import { FleetSegments } from '../components/molecules/fleet-segments';
import { useAccess } from '../lib/access';
import { useFleetLimits } from '../lib/fleet-limits';
import { useHostedAccountUrl } from '../lib/hosted-account';
import { messageLimitNotice, messageLimitReached } from '../lib/limits';
import { useFleetSnapshot } from '../lib/fleet';
import { fleetViewParams, readFleetView, urlParamsOf, type FleetView } from '../lib/fleet-filter';
import { useOpenInboxCount } from '../lib/inbox';
import { useLiveFleet } from '../lib/live-fleet';
import { overviewSubtitle } from '../lib/overview-metrics';
import { useNow } from '../lib/now';
import { useAttentionCount } from '../lib/needs-attention';
import { useAccountMenu } from '../lib/account';
import { useSignInWhenSessionEnds } from '../lib/session';
import { usePluginNav } from '../lib/plugin-nav';

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The fleet overview, live: every ship with its status, where it runs and its
 * actions, updated as the fleet changes, without a reload. Search and filters
 * live in the URL. Without a session it sends the operator to sign in.
 */
export default function FleetPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const router = useRouter();
  const params = urlParamsOf(use(searchParams));
  const view = readFleetView(params);
  // The command palette's Commission ship lands here with the dialog open.
  const isCommissionAsked = params.get('commission') === 'new';
  const fleet = useFleetSnapshot();
  const liveFleet = useLiveFleet();
  const now = useNow();
  const accountMenu = useAccountMenu(now);
  const messageLimit = messageLimitReached(useFleetLimits().data);
  const accountUrl = useHostedAccountUrl();
  const inboxCount = useOpenInboxCount();
  const access = useAccess();
  const pluginNav = usePluginNav();
  const [isComposing, setIsComposing] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isCommissioning, setIsCommissioning] = useState(false);
  const attentionCount = useAttentionCount();
  useSignInWhenSessionEnds([fleet.error, liveFleet.error]);

  const changeView = (next: FleetView) => {
    const params = fleetViewParams(next).toString();
    router.replace(params === '' ? '/' : `/?${params}`, { scroll: false });
  };

  return (
    <ListLayout
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
      nav={{ active: 'overview', inboxCount, attentionCount, ...pluginNav }}
      onCompose={
        access.canSend
          ? () => {
              setIsComposing(true);
            }
          : undefined
      }
      onSearch={() => {
        setIsSearching(true);
      }}
      account={accountMenu}
      banner={
        <>
          <ConsoleNotices />
          <ConsoleGuide />
        </>
      }
    >
      <FleetSegments active="ships" needsCrewCount={pluginNav.needsCrewCount} />
      {messageLimit === undefined ? null : <LimitNotice {...messageLimitNotice(messageLimit)} accountUrl={accountUrl} testId="overview-message-limit" />}
      <FleetLimits />
      <OverviewMetrics />
      <FleetOverview view={view} onViewChange={changeView} newShipIds={liveFleet.newShipIds} />
      <ComposeMessage isOpen={isComposing} onOpenChange={setIsComposing} />
      <ConsoleCommands
        isOpen={isSearching}
        onOpenChange={setIsSearching}
        onCompose={() => {
          setIsComposing(true);
        }}
      />
    </ListLayout>
  );
}
