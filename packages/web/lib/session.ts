import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { isSignedInElsewhere, trpcErrorCode } from './errors';
import { useTRPC } from './trpc';

/** Where a console whose session is gone sends the operator: the sign-in page, saying why when it was no failure. */
function signInPathFor(error: unknown): string {
  return isSignedInElsewhere(error) ? '/sign-in?notice=signed-in-elsewhere' : '/sign-in';
}

/**
 * Sends the operator to sign in once any of the page's calls is refused for
 * want of a session, forgetting what the console had loaded.
 */
export function useSignInWhenSessionEnds(errors: readonly unknown[]): void {
  const router = useRouter();
  const queryClient = useQueryClient();
  const sessionError = errors.find((error) => trpcErrorCode(error) === 'UNAUTHORIZED');
  const signInPath = sessionError === undefined ? undefined : signInPathFor(sessionError);
  useEffect(() => {
    if (signInPath !== undefined) {
      queryClient.clear();
      router.replace(signInPath);
    }
  }, [signInPath, queryClient, router]);
}

/** Signs out: the session ends on the server, and the console goes to sign in. */
export function useSignOut(): () => void {
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const signOut = useMutation(
    trpc.console.signOut.mutationOptions({
      onSuccess: () => {
        queryClient.clear();
        router.replace('/sign-in');
      },
    }),
  );
  return () => {
    signOut.mutate();
  };
}
