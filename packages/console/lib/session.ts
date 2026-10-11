import { onlineManager, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { isSignedInElsewhere, trpcErrorCode } from './errors';

/** Where a console whose session is gone sends the operator: the sign-in page, saying why when it was no failure. */
function signInPathFor(error: unknown): string {
  return isSignedInElsewhere(error) ? '/sign-in?notice=signed-in-elsewhere' : '/sign-in';
}

/**
 * Sends the operator to sign in once any of the page's calls is refused for
 * want of a session, forgetting what the console had loaded as the page goes.
 * It forgets only then: forgetting while the page still shows would ask every
 * call it holds again, each refused again, in a loop that keeps the page from
 * leaving.
 */
export function useSignInWhenSessionEnds(errors: readonly unknown[]): void {
  const router = useRouter();
  const queryClient = useQueryClient();
  const sessionError = errors.find((error) => trpcErrorCode(error) === 'UNAUTHORIZED');
  const signInPath = sessionError === undefined ? undefined : signInPathFor(sessionError);
  const isLeaving = useRef(false);
  useEffect(() => {
    if (signInPath !== undefined) {
      isLeaving.current = true;
      router.replace(signInPath);
    }
  }, [signInPath, router]);
  useEffect(
    () => () => {
      if (isLeaving.current) {
        queryClient.clear();
      }
    },
    [queryClient],
  );
}

/**
 * Leaves a page whose session Sign out has just ended for one without a
 * session. From then until the page has gone the console asks nothing: a slow
 * way out still polls and mounts, and every call would carry no session
 * (#584). TanStack Query holds every call while it is offline, so the console
 * counts as offline meanwhile. As the page goes it forgets what it loaded, so
 * nothing held is asked, and the next page asks as usual.
 */
export function useLeaveSignedOut(): (path: string) => void {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isLeavingRef = useRef(false);
  useEffect(
    () => () => {
      if (isLeavingRef.current) {
        queryClient.clear();
        onlineManager.setOnline(true);
      }
    },
    [queryClient],
  );
  return (path) => {
    isLeavingRef.current = true;
    onlineManager.setOnline(false);
    router.replace(path);
  };
}
