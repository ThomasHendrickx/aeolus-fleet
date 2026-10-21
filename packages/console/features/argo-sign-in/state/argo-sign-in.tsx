'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { postTo } from '../../../lib/account';
import { useTRPC } from '../../../lib/trpc';
import { ArgoBanner } from '../ui/molecules/argo-banner';

/**
 * The argo banner while this console session is a sign-in as argo by an
 * account (accounts design, A7): argo's own sign-in names no account, so it
 * shows none. Sign out of argo posts to the web app's server, which ends this
 * session alone and enters the fleet as the account again.
 */
export function ArgoSignIn() {
  const trpc = useTRPC();
  const account = useQuery(trpc.console.account.queryOptions());
  const [isSigningOut, setIsSigningOut] = useState(false);
  if (account.data?.kind !== 'operator' || account.data.session.accountId == null) {
    return null;
  }
  return (
    <ArgoBanner
      isSigningOut={isSigningOut}
      onSignOutOfArgo={() => {
        setIsSigningOut(true);
        postTo('/sign-in/argo/out');
      }}
    />
  );
}
