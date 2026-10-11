import { onlineManager, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useEffectEvent, useRef } from 'react';

import { isSignedInElsewhere, trpcErrorCode } from './errors';
import { useTRPC } from './trpc';

/** Where a console whose session is gone sends the operator: the sign-in page, saying why when it was no failure. */
function signInPathFor(error: unknown): string {
  return isSignedInElsewhere(error) ? '/sign-in?notice=signed-in-elsewhere' : '/sign-in';
}

/**
 * Sends the operator to sign in once any of the page's calls is refused for
 * want of a session. From then the page asks nothing while it is on its way
 * out, and forgets what the console had loaded only as it goes: forgetting
 * while the page still shows would ask every call it holds again, each
 * refused again, in a loop that keeps the page from leaving.
 */
export function useSignInWhenSessionEnds(errors: readonly unknown[]): void {
  const wayOut = useWayOut();
  const sessionError = errors.find((error) => trpcErrorCode(error) === 'UNAUTHORIZED');
  const signInPath = sessionError === undefined ? undefined : signInPathFor(sessionError);
  const leave = useEffectEvent((path: string) => {
    wayOut.leave(path);
  });
  useEffect(() => {
    if (signInPath !== undefined) {
      leave(signInPath);
    }
  }, [signInPath]);
}

/**
 * The way out of a page whose session has ended, or is ending, for one
 * without a session. While the console holds its calls it asks nothing: a
 * call asked then would race Sign out, or carry no session (#584, #611).
 * TanStack Query holds every call while it is offline, so the console counts
 * as offline meanwhile. Leaving, it forgets what it loaded only as the page
 * goes, since forgetting while the page still shows asks every read again;
 * the next page asks as usual.
 */
function useWayOut(): { holdCalls: () => void; letCallsGo: () => void; leave: (destination: string) => void } {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isHoldingRef = useRef(false);
  useEffect(
    () => () => {
      if (isHoldingRef.current) {
        queryClient.clear();
        onlineManager.setOnline(true);
      }
    },
    [queryClient],
  );
  const holdCalls = () => {
    isHoldingRef.current = true;
    onlineManager.setOnline(false);
  };
  return {
    holdCalls,
    letCallsGo: () => {
      isHoldingRef.current = false;
      onlineManager.setOnline(true);
    },
    leave: (destination) => {
      holdCalls();
      if (destination.startsWith('/')) {
        router.replace(destination);
      } else {
        window.location.assign(destination);
      }
    },
  };
}

/**
 * Sign out, as every way the operator signs out asks it: from the moment it
 * is asked the console holds every other call. Once it has ended the session
 * the page leaves for destination, a console path or another site. Should it
 * fail, the operator is still signed in, the held calls go and onError says so.
 */
export function useSignOut(): { signOut: (destination: string, onError: () => void) => void; isSigningOut: boolean } {
  const trpc = useTRPC();
  const wayOut = useWayOut();
  // Sign out itself goes while the console counts as offline.
  const mutation = useMutation(trpc.console.signOut.mutationOptions({ networkMode: 'always' }));
  return {
    signOut: (destination, onError) => {
      wayOut.holdCalls();
      mutation.mutate(undefined, {
        onSuccess: () => {
          wayOut.leave(destination);
        },
        onError: () => {
          wayOut.letCallsGo();
          onError();
        },
      });
    },
    isSigningOut: mutation.isPending,
  };
}
