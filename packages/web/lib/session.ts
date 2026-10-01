import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { isSignedInElsewhere, trpcErrorCode } from './errors';

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
