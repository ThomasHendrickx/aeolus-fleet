'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { Button } from '../components/atoms/button';
import { Skeleton } from '../components/atoms/skeleton';
import { CommissionShipForm } from '../components/organisms/commission-ship-form';
import { FleetList } from '../components/organisms/fleet-list';
import { trpcErrorCode } from '../lib/errors';
import { useFleetSnapshot } from '../lib/fleet';
import { useTRPC } from '../lib/trpc';

/**
 * The fleet page: the fleet, commissioning a ship and its starting prompts, in
 * a plain column until the app shell arrives. Without a session it sends the
 * operator to sign in.
 */
/** One padded column; the app shell (Sidebar, Header) replaces it later. */
const PAGE = 'flex w-full flex-col gap-5 px-4 py-6 sm:px-8';

export default function ConsolePage() {
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const fleet = useFleetSnapshot();
  const signOut = useMutation(
    trpc.console.signOut.mutationOptions({
      onSuccess: () => {
        queryClient.clear();
        router.replace('/sign-in');
      },
    }),
  );

  const isSignedOut = trpcErrorCode(fleet.error) === 'UNAUTHORIZED';
  useEffect(() => {
    if (isSignedOut) {
      router.replace('/sign-in');
    }
  }, [isSignedOut, router]);

  if (fleet.isPending || isSignedOut) {
    return (
      <main aria-busy className={PAGE}>
        <span className="sr-only">Loading...</span>
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </main>
    );
  }

  if (fleet.isError) {
    return (
      <main className={PAGE}>
        <p role="alert" className="text-body text-tone-attention-fg">
          The server did not answer: <span className="font-mono text-id">{fleet.error.message}</span>
        </p>
      </main>
    );
  }

  return (
    <main className={PAGE}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-title font-semibold tracking-tight max-sm:text-title-touch">Aeolus</h1>
          <p className="text-meta text-muted-foreground">Signed in as argo.</p>
        </div>
        <Button
          size="sm"
          isLoading={signOut.isPending}
          onClick={() => {
            signOut.mutate();
          }}
        >
          Sign out
        </Button>
      </div>
      <CommissionShipForm />
      <FleetList />
    </main>
  );
}
