'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { trpcErrorCode } from '../lib/errors';
import { useTRPC } from '../lib/trpc';

/**
 * The signed-in placeholder: proves the console session reaches the database
 * through an authorised call. The console design comes later.
 */
export default function ConsolePage() {
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const ping = useQuery(trpc.system.ping.queryOptions());
  const signOut = useMutation(
    trpc.console.signOut.mutationOptions({
      onSuccess: () => {
        queryClient.clear();
        router.replace('/sign-in');
      },
    }),
  );

  const isSignedOut = trpcErrorCode(ping.error) === 'UNAUTHORIZED';
  useEffect(() => {
    if (isSignedOut) {
      router.replace('/sign-in');
    }
  }, [isSignedOut, router]);

  if (ping.isPending || isSignedOut) {
    return <p>Loading...</p>;
  }

  if (ping.isError) {
    return <p role="alert">The server did not answer: {ping.error.message}</p>;
  }

  return (
    <main>
      <h1>Aeolus</h1>
      <p>Signed in as argo.</p>
      <dl>
        <dt>Server time</dt>
        <dd>
          <time dateTime={ping.data.serverTime}>{new Date(ping.data.serverTime).toLocaleString()}</time>
        </dd>
        <dt>Fleets</dt>
        <dd>{ping.data.fleetCount}</dd>
      </dl>
      <button type="button" disabled={signOut.isPending} onClick={() => { signOut.mutate(); }}>
        Sign out
      </button>
    </main>
  );
}
