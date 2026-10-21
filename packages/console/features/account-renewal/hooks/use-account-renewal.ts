'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useEffectEvent, useState } from 'react';

import { renewalDelayOf, retryDelayOf } from '../../../lib/account-renewal-schedule';
import { useLiveUpdates } from '../../../lib/live-updates';
import { useWayOut } from '../../../lib/session';
import { NO_RIGHTS_PATH, NOTHING_TO_MANAGE_PATH, signInEndedPathOf } from '../../../lib/sign-in-paths';
import { useTRPC } from '../../../lib/trpc';
import { renew } from '../services/renew';

/**
 * Keeps an account signed in across its token's end (accounts design, F2,
 * A3 to A6): a little before the token ends the console's server renews it
 * with the shared sign-in; the live updates then reopen with the fresh
 * cookie and the session is read again, so the pages follow its scopes. When
 * pagasae does not answer it retries, more slowly each time, until the token
 * ends; when pagasae ended the sign-in the account goes to sign in again,
 * back to the page it was on. Argo's and the viewer's sessions renew nothing.
 */
export function useAccountRenewal(): { isRetrying: boolean } {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const live = useLiveUpdates();
  const wayOut = useWayOut();
  const session = useQuery(trpc.console.session.queryOptions()).data;
  const [attempt, setAttempt] = useState(0);
  const isAccount = session?.kind === 'account';
  const endsAt = session?.expiresAt;
  const hasNothingToManage = isAccount && !session.scopes.includes('fleet:read');

  const renewNow = useEffectEvent(async () => {
    const outcome = await renew();
    const here = `${window.location.pathname}${window.location.search}`;
    switch (outcome) {
      case 'renewed':
        setAttempt(0);
        live.reopen();
        await queryClient.invalidateQueries({ queryKey: trpc.console.session.queryKey() });
        return;
      case 'unreachable':
        setAttempt((tried) => tried + 1);
        return;
      case 'ended':
        wayOut.leave(signInEndedPathOf(here));
        return;
      case 'noRights':
        wayOut.leave(NO_RIGHTS_PATH);
        return;
    }
  });

  useEffect(() => {
    if (!isAccount || endsAt === undefined) {
      return;
    }
    const delay = attempt === 0 ? renewalDelayOf({ endsAt: new Date(endsAt), now: new Date() }) : retryDelayOf(attempt - 1);
    const timer = setTimeout(() => {
      void renewNow();
    }, delay);
    return () => {
      clearTimeout(timer);
    };
  }, [isAccount, endsAt, attempt]);

  // A renewal that took fleet:read away leaves nothing for the console to show (A8).
  const leaveForNothingToManage = useEffectEvent(() => {
    wayOut.leave(NOTHING_TO_MANAGE_PATH);
  });
  useEffect(() => {
    if (hasNothingToManage) {
      leaveForNothingToManage();
    }
  }, [hasNothingToManage]);

  return { isRetrying: attempt > 0 };
}
