'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { use, useEffect } from 'react';

import { CommissionShipForm } from '../components/organisms/commission-ship-form';
import { FleetOverview } from '../components/organisms/fleet-overview';
import { ListLayout } from '../components/templates/list-layout';
import { isSignedInElsewhere, trpcErrorCode } from '../lib/errors';
import { useFleetSnapshot } from '../lib/fleet';
import { fleetViewParams, readFleetView, type FleetView } from '../lib/fleet-filter';
import { useLiveFleet } from '../lib/live-fleet';
import { useTRPC } from '../lib/trpc';

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

/** Where a console whose session is gone sends the operator: the sign-in page, saying why when it was no failure. */
function signInPathFor(error: unknown): string {
  return isSignedInElsewhere(error) ? '/sign-in?notice=signed-in-elsewhere' : '/sign-in';
}

/**
 * The fleet overview, live: every ship with its status, where it runs and its
 * actions, updated as the fleet changes, without a reload. Search and filters
 * live in the URL. Without a session it sends the operator to sign in.
 */
export default function FleetPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const view = readFleetView(toUrlParams(use(searchParams)));
  const fleet = useFleetSnapshot();
  const liveFleet = useLiveFleet();
  const signOut = useMutation(
    trpc.console.signOut.mutationOptions({
      onSuccess: () => {
        queryClient.clear();
        router.replace('/sign-in');
      },
    }),
  );

  const sessionError = [fleet.error, liveFleet.error].find((error) => trpcErrorCode(error) === 'UNAUTHORIZED');
  const signInPath = sessionError === undefined ? undefined : signInPathFor(sessionError);
  useEffect(() => {
    if (signInPath !== undefined) {
      queryClient.clear();
      router.replace(signInPath);
    }
  }, [signInPath, queryClient, router]);

  const changeView = (next: FleetView) => {
    const params = fleetViewParams(next).toString();
    router.replace(params === '' ? '/' : `/?${params}`, { scroll: false });
  };

  return (
    <ListLayout
      title="Fleet overview"
      description="Every ship in the fleet, live."
      live={liveFleet.live}
      onSignOut={() => {
        signOut.mutate();
      }}
    >
      <CommissionShipForm />
      <FleetOverview view={view} onViewChange={changeView} newShipIds={liveFleet.newShipIds} />
    </ListLayout>
  );
}
