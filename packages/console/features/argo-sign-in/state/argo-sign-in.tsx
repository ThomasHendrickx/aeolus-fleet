'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { AFTER_ARGO_SIGN_OUT_PATH } from '../../../lib/sign-in-paths';
import { useTRPC } from '../../../lib/trpc';
import { ArgoBanner } from '../ui/molecules/argo-banner';

const SIGN_OUT_FAILED = 'Couldn’t sign out of argo. The server did not answer. Try again.';

/** Asks the web app's server to end this sign-in as argo; whether it did. */
async function isSignedOutOfArgo(): Promise<boolean> {
  try {
    const answer = await fetch('/sign-in/argo/out', { method: 'POST', cache: 'no-store' });
    return answer.ok;
  } catch {
    return false;
  }
}

/**
 * The argo banner while this console session is a sign-in as argo by an
 * account (accounts design, A7): argo's own sign-in names no account, so it
 * shows none. Sign out of argo asks the web app's server to end this session
 * alone, then enters the fleet as the account again; it says so when that fails.
 */
export function ArgoSignIn() {
  const trpc = useTRPC();
  const account = useQuery(trpc.console.account.queryOptions());
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  if (account.data?.kind !== 'operator' || account.data.session.accountId == null) {
    return null;
  }
  return (
    <ArgoBanner
      isSigningOut={isSigningOut}
      {...(error === undefined ? {} : { error })}
      onSignOutOfArgo={() => {
        setIsSigningOut(true);
        setError(undefined);
        void isSignedOutOfArgo().then((isSignedOut) => {
          if (isSignedOut) {
            window.location.assign(AFTER_ARGO_SIGN_OUT_PATH);
            return;
          }
          setIsSigningOut(false);
          setError(SIGN_OUT_FAILED);
        });
      }}
    />
  );
}
