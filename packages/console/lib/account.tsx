import type { Account } from '@aeolus-fleet/common';
import { useQuery } from '@tanstack/react-query';

import type { AvatarMenuProps } from '@aeolus-fleet/ui';

import { showToast } from '@aeolus-fleet/ui';
import { sessionSince } from './theme';
import { fetchConsoleRead } from './fetch-console-read';
import { useSignOut } from './session';
import { useTRPC } from './trpc';

/**
 * An account signs out of every Aeolus app at once (header design, H5): the
 * web app's server ends the shared sign-in at the account app and core's token
 * cookie, so the browser posts there and follows where it leads.
 */
function signOutOfEveryApp(): void {
  postTo('/sign-in/out');
}

/** The browser posts to a sign-in route of the web app's server and follows where it leads. */
export function postTo(action: string): void {
  const form = document.createElement('form');
  form.method = 'post';
  form.action = action;
  document.body.append(form);
  form.submit();
}

/** The account this console sign-in names: an account's own, or the one signed in as argo; none for argo's own sign-in and a viewer. */
function signedInAccountIdOf(account: Account): string | null {
  return account.kind === 'account' ? account.accountId : (account.session.accountId ?? null);
}

/**
 * The account panel's data and actions on every console page
 * (docs/design/app-navigation, section 4; header design H8, H10): who is
 * signed in here and how, where argo's or the viewer's sign-in holds
 * ("Console in Aeolus"), this session, and Sign out. Signing out ends the
 * session and goes to sign in; a failure says so in a toast with Try again,
 * and the operator stays signed in. An account goes by the name the account
 * app gives it, with no session line, and signs out of every app. The other
 * items live in Settings (useSettingsItems).
 */
export function useAccountMenu(now: Date): AvatarMenuProps {
  const trpc = useTRPC();
  const account = useQuery(trpc.console.account.queryOptions());
  const session = useQuery(trpc.console.session.queryOptions());
  const signedInAccountId = account.data === undefined ? null : signedInAccountIdOf(account.data);
  // The account's name as the account app gives it, asked by the web app's server and never stored (decisions 0054, 0058); the id shows until it answers.
  const accountName = useQuery({
    queryKey: ['account-name', signedInAccountId],
    queryFn: () => fetchConsoleRead({ read: 'account-name' }),
    enabled: signedInAccountId !== null,
  });
  const { signOut, isSigningOut } = useSignOut();
  const trySignOut = () => {
    if (account.data?.kind === 'account') {
      signOutOfEveryApp();
      return;
    }
    signOut('/sign-in', () => {
      showToast({
        title: 'Couldn’t sign out',
        description: 'The server did not answer. You are still signed in.',
        tone: 'error',
        action: { label: 'Try again', onClick: trySignOut },
      });
    });
  };

  const held = account.data;
  return {
    name: held?.kind === 'viewer' ? undefined : typeof accountName.data === 'string' ? accountName.data : held?.kind === 'account' ? held.accountId : undefined,
    signedInAs: held === undefined ? undefined : held.kind === 'operator' ? 'argo' : held.kind,
    ...(held === undefined || held.kind === 'account' ? {} : { session: sessionSince(held.session, now) }),
    ...(held === undefined || held.kind === 'account' || session.data === undefined ? {} : { signedInFor: `Console in ${session.data.fleetName}` }),
    onSignOut: trySignOut,
    isSigningOut,
  };
}
