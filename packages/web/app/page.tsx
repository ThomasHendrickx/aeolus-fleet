'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { CommissionShipForm } from '../components/organisms/commission-ship-form';
import { FleetList } from '../components/organisms/fleet-list';
import { trpcErrorCode } from '../lib/errors';
import { useFleetSnapshot } from '../lib/fleet';
import { useTRPC } from '../lib/trpc';

/**
 * The fleet page, bare until the console design: the fleet, commissioning a
 * ship and its starting prompts. Without a session it sends the operator to
 * sign in.
 */
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
    return <p>Loading...</p>;
  }

  if (fleet.isError) {
    return <p role="alert">The server did not answer: {fleet.error.message}</p>;
  }

  return (
    <main>
      <h1>Aeolus</h1>
      <p>Signed in as argo.</p>
      <button type="button" disabled={signOut.isPending} onClick={() => { signOut.mutate(); }}>
        Sign out
      </button>
      <CommissionShipForm />
      <FleetList />
    </main>
  );
}
