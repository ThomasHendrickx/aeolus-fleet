'use client';

import { useRouter } from 'next/navigation';
import { use, useState } from 'react';

import { ComposeMessage } from '../components/organisms/compose-message';
import { CommissionShipForm } from '../components/organisms/commission-ship-form';
import { FleetOverview } from '../components/organisms/fleet-overview';
import { ListLayout } from '../components/templates/list-layout';
import { useFleetSnapshot } from '../lib/fleet';
import { fleetViewParams, readFleetView, type FleetView } from '../lib/fleet-filter';
import { useOpenInboxCount } from '../lib/inbox';
import { useLiveFleet } from '../lib/live-fleet';
import { useAttentionCount } from '../lib/needs-attention';
import { useSignInWhenSessionEnds, useSignOut } from '../lib/session';

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
  const view = readFleetView(toUrlParams(use(searchParams)));
  const fleet = useFleetSnapshot();
  const liveFleet = useLiveFleet();
  const signOut = useSignOut();
  const inboxCount = useOpenInboxCount();
  const [isComposing, setIsComposing] = useState(false);
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
      live={liveFleet.live}
      nav={{ active: 'overview', inboxCount, attentionCount }}
      onCompose={() => {
        setIsComposing(true);
      }}
      onSignOut={signOut}
    >
      <CommissionShipForm />
      <FleetOverview view={view} onViewChange={changeView} newShipIds={liveFleet.newShipIds} />
      <ComposeMessage isOpen={isComposing} onOpenChange={setIsComposing} />
    </ListLayout>
  );
}
