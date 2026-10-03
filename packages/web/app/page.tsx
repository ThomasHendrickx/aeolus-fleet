'use client';

import { useRouter } from 'next/navigation';
import { use, useState } from 'react';

import { ComposeMessage } from '../components/organisms/compose-message';
import { ConsoleCommands } from '../components/organisms/console-commands';
import { CommissionShip } from '../components/organisms/commission-ship';
import { FleetOverview } from '../components/organisms/fleet-overview';
import { ListLayout } from '../components/templates/list-layout';
import { useFleetSnapshot } from '../lib/fleet';
import { fleetViewParams, readFleetView, type FleetView } from '../lib/fleet-filter';
import { useOpenInboxCount } from '../lib/inbox';
import { useLiveFleet } from '../lib/live-fleet';
import { useNow } from '../lib/now';
import { useAttentionCount } from '../lib/needs-attention';
import { useAccountMenu } from '../lib/account';
import { useSignInWhenSessionEnds } from '../lib/session';
import { useHasSquadrons } from '../lib/squadrons';

type SearchParams = Record<string, string | string[] | undefined>;

/** The page's search parameters as URLSearchParams; a repeated one keeps its first value. */
function toUrlParams(searchParams: SearchParams): URLSearchParams {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(searchParams)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined) {
      params.set(name, first);
    }
  }
  return params;
}

/**
 * The fleet overview, live: every ship with its status, where it runs and its
 * actions, updated as the fleet changes, without a reload. Search and filters
 * live in the URL. Without a session it sends the operator to sign in.
 */
export default function FleetPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const router = useRouter();
  const params = toUrlParams(use(searchParams));
  const view = readFleetView(params);
  // The command palette's Commission ship lands here with the dialog open.
  const isCommissionAsked = params.get('commission') === 'new';
  const fleet = useFleetSnapshot();
  const liveFleet = useLiveFleet();
  const now = useNow();
  const accountMenu = useAccountMenu(now);
  const hasSquadrons = useHasSquadrons();
  const inboxCount = useOpenInboxCount();
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
      description="Every ship in the fleet, live."
      primaryAction={
        <CommissionShip
          isOpen={isCommissioning || isCommissionAsked}
          onOpenChange={(isOpen) => {
            setIsCommissioning(isOpen);
            if (!isOpen && isCommissionAsked) {
              changeView(view);
            }
          }}
        />
      }
      live={liveFleet.live}
      nav={{ active: 'overview', inboxCount, attentionCount , hasSquadrons }}
      onCompose={() => {
        setIsComposing(true);
      }}
      onSearch={() => {
        setIsSearching(true);
      }}
      account={accountMenu}
    >
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
