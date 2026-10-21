import type { Account, Theme } from '@aeolus-fleet/common';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { AvatarMenuProps } from '@aeolus-fleet/common/header';
import { Compass, Network, Settings } from 'lucide-react';

import { showToast } from '../components/atoms/toast';
import { useAppsList } from './app-switcher';
import { applyTheme, sessionSince } from './theme';
import { useConsoleConstants } from './console-constants';
import { fetchConsoleRead } from './fetch-console-read';
import { useConsoleGuide } from './guide';
import { useSignOut } from './session';
import { useTRPC } from './trpc';
import { usePluginNav } from './plugin-nav';
import { SOURCE_URL } from './source';

/** The keyboard shortcuts the console offers, for the avatar menu's dialog. */
const SHORTCUTS = [
  { keys: ['⌘', 'K'], label: 'Search ships or jump to' },
  { keys: ['⌘', '↵'], label: 'Send a message' },
];

/**
 * An account signs out of every Aeolus app at once (header design, H5): the
 * web app's server ends the shared sign-in at pagasae and core's token
 * cookie, so the browser posts there and follows where it leads.
 */
function signOutOfEveryApp(): void {
  const form = document.createElement('form');
  form.method = 'post';
  form.action = '/sign-in/out';
  document.body.append(form);
  form.submit();
}

/** The account this console sign-in names: an account's own, or the one signed in as argo; none for argo's own sign-in and a viewer. */
function signedInAccountIdOf(account: Account): string | null {
  return account.kind === 'account' ? account.accountId : (account.session.accountId ?? null);
}

/**
 * The avatar menu's data and actions on every console page (header design
 * H8, H10): who is signed in here and how, this session, the account's own
 * pages in Account when the apps list names it, Take the tour, Settings and
 * Network on phone, the theme, shortcuts, help, and Sign out. A theme shows
 * at once and is stored on the account. Signing out ends the session and
 * goes to sign in; a failure says so in a toast with Try again, and the
 * operator stays signed in. An account goes by the name pagasae gives it,
 * with no session line and no theme, and signs out of every app.
 */
export function useAccountMenu(now: Date): AvatarMenuProps {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const account = useQuery(trpc.console.account.queryOptions());
  const signedInAccountId = account.data === undefined ? null : signedInAccountIdOf(account.data);
  // The account's name as pagasae gives it, asked by the web app's server and never stored (decisions 0054, 0058); the id shows until it answers.
  const accountName = useQuery({
    queryKey: ['account-name', signedInAccountId],
    queryFn: () => fetchConsoleRead({ read: 'account-name' }),
    enabled: signedInAccountId !== null,
  });
  const appsList = useAppsList();
  const accountUrl = appsList?.apps.find((link) => link.app === 'account')?.url;
  const { themes } = useConsoleConstants();
  const guide = useConsoleGuide();
  // The phone's tab bar has no place for Settings or Network: the account sheet offers each while it is offered (#245, #503).
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
    ...(accountUrl === undefined ? {} : { accountUrl }),
    theme: held?.kind === 'operator' ? held.theme : undefined,
    themes,
    hasTheme: held?.kind === 'operator' || held === undefined,
    onThemeChange: (theme: Theme) => {
      setTheme.mutate({ theme });
    },
    shortcuts: SHORTCUTS,
    helpUrl: SOURCE_URL,
    onSignOut: trySignOut,
    isSigningOut,
    entries: [
      ...(guide.onTakeTour === undefined ? [] : [{ key: 'take-tour', label: 'Take the tour', icon: <Compass aria-hidden />, onSelect: guide.onTakeTour }]),
      ...(pluginNav.hasNetwork ? [{ key: 'network', label: 'Network', icon: <Network aria-hidden />, href: '/network', isPhoneOnly: true }] : []),
      ...(pluginNav.hasSettings ? [{ key: 'settings', label: 'Settings', icon: <Settings aria-hidden />, href: '/settings', isPhoneOnly: true }] : []),
    ],
  };
}
