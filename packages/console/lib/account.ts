import type { Account, Theme } from '@aeolus-fleet/common';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

import { showToast } from '../components/atoms/toast';
import type { AccountMenuProps } from '../components/organisms/account-menu';
import { useHostedAccountUrl } from './hosted-account';
import { applyTheme } from './theme';
import { useConsoleConstants } from './console-constants';
import { useConsoleGuide } from './guide';
import { useTRPC } from './trpc';
import { usePluginNav } from './plugin-nav';

/**
 * The AccountMenu's data and actions on every console page: who is signed
 * in, this session, the hosting service's account page when it is set, the
 * theme, and Sign out. A theme shows at once and is
 * stored on the account. Signing out ends the session and goes to sign in; a
 * failure says so in a toast with Try again, and the operator stays signed in.
 */
export function useAccountMenu(now: Date): AccountMenuProps {
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const account = useQuery(trpc.console.account.queryOptions());
  const accountUrl = useHostedAccountUrl();
  const { themes } = useConsoleConstants();
  const guide = useConsoleGuide();
  // With the trierarch plugin on, the phone's tab bar has no room for Settings: the account sheet offers it (#245, decision 6).
  const pluginNav = usePluginNav();
  const setTheme = useMutation(
    trpc.console.setTheme.mutationOptions({
      onMutate: ({ theme }) => {
        applyTheme(theme);
        queryClient.setQueryData(trpc.console.account.queryKey(), (held: Account | undefined) => {
          if (held?.kind !== 'operator') {
            return held;
          }
          return { ...held, theme };
        });
      },
      onError: () => {
        showToast({ title: 'Couldn’t save the theme', description: 'It applies here until the page reloads.', tone: 'error' });
      },
    }),
  );
  const signOut = useMutation(
    trpc.console.signOut.mutationOptions({
      onSuccess: () => {
        queryClient.clear();
        router.replace('/sign-in');
      },
    }),
  );
  const trySignOut = () => {
    signOut.mutate(undefined, {
      onError: () => {
        showToast({
          title: 'Couldn’t sign out',
          description: 'The server did not answer. You are still signed in.',
          tone: 'error',
          action: { label: 'Try again', onClick: trySignOut },
        });
      },
    });
  };

  return {
    ...(pluginNav.hasTrierarchs && pluginNav.hasSettings ? { settingsHref: '/settings' } : {}),
    account: account.data,
    themes,
    onThemeChange: (theme: Theme) => {
      setTheme.mutate({ theme });
    },
    onSignOut: trySignOut,
    isSigningOut: signOut.isPending,
    now,
    ...(accountUrl === undefined ? {} : { accountUrl }),
    ...(guide.onTakeTour === undefined ? {} : { onTakeTour: guide.onTakeTour }),
  };
}
