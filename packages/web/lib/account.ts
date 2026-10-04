import type { Theme } from '@aeolus-fleet/common';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

import { showToast } from '../components/atoms/toast';
import type { AccountMenuProps } from '../components/organisms/account-menu';
import { useHostedAccountUrl } from './hosted-account';
import { applyTheme } from './theme';
import { useTRPC } from './trpc';

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
  const setTheme = useMutation(
    trpc.console.setTheme.mutationOptions({
      onMutate: ({ theme }) => {
        applyTheme(theme);
        queryClient.setQueryData(trpc.console.account.queryKey(), (held) => held && { ...held, theme });
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
    account: account.data,
    onThemeChange: (theme: Theme) => {
      setTheme.mutate({ theme });
    },
    onSignOut: trySignOut,
    isSigningOut: signOut.isPending,
    now,
    ...(accountUrl === undefined ? {} : { accountUrl }),
  };
}
