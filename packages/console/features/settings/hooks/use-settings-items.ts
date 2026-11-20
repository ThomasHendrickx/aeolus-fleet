'use client';

import type { Theme } from '@aeolus-fleet/common';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { postTo } from '../../../lib/account';
import { isArgoAllowedIn, useAppsList } from '../../../lib/app-switcher';
import { useBrowserTheme, useKeepBrowserTheme } from '../../../lib/browser-theme-client';
import { useConsoleConstants } from '../../../lib/console-constants';
import { useConsoleGuide } from '../../../lib/guide';
import { usePluginNav } from '../../../lib/plugin-nav';
import { SOURCE_URL } from '../../../lib/source';
import { useTRPC } from '../../../lib/trpc';

/** The keyboard shortcuts the console offers, for Settings' dialog. */
const SHORTCUTS = [
  { keys: ['⌘', 'K'], label: 'Search ships or jump to' },
  { keys: ['⌘', '↵'], label: 'Send a message' },
];

/** What Settings shows every sign-in, each under its own rule (docs/design/app-navigation, where the account menu's items go). */
export interface SettingsItems {
  /** Network as Settings' first row on phone: for a session holding fleet:network while the networking plugin is connected. */
  hasNetwork: boolean;
  theme: Theme | undefined;
  themes: readonly Theme[];
  /** The viewer has no theme switch (0022); argo and an account do. */
  hasThemeSwitch: boolean;
  onThemeChange: (theme: Theme) => void;
  shortcuts: typeof SHORTCUTS;
  helpUrl: string;
  /** Unset while no guide is set for the session (0024). */
  onTakeTour?: () => void;
  /** Account's address, while the apps list names it (H8). */
  accountUrl?: string;
  /** Signs the account in as argo, while the apps list allows it in this fleet (A7). */
  onSignInAsArgo?: () => void;
  isSigningInAsArgo: boolean;
}

/**
 * Theme, Help and Your account, which Settings holds for every sign-in: the
 * theme this browser keeps, applied at once; the shortcuts, the
 * documentation and the tour; the account's own pages in Account and Sign in
 * as argo, which posts to the web app's server and says it is working until
 * the page leaves.
 */
export function useSettingsItems(): SettingsItems {
  const trpc = useTRPC();
  const account = useQuery(trpc.console.account.queryOptions());
  const session = useQuery(trpc.console.session.queryOptions());
  const appsList = useAppsList();
  const { themes } = useConsoleConstants();
  const theme = useBrowserTheme();
  const keepTheme = useKeepBrowserTheme();
  const guide = useConsoleGuide();
  const pluginNav = usePluginNav();
  const [isSigningInAsArgo, setIsSigningInAsArgo] = useState(false);
  const accountUrl = appsList?.apps.find((link) => link.app === 'account')?.url;
  const isArgoAllowed = account.data?.kind === 'account' && isArgoAllowedIn(appsList, session.data?.fleetId);
  return {
    hasNetwork: pluginNav.hasNetwork,
    // Unknown until the sign-in is: a viewer's has no switch.
    theme: account.data === undefined ? undefined : theme,
    themes,
    // A viewer's has none; none shows either until the sign-in is known.
    hasThemeSwitch: account.data !== undefined && account.data.kind !== 'viewer',
    onThemeChange: keepTheme,
    shortcuts: SHORTCUTS,
    helpUrl: SOURCE_URL,
    ...(guide.onTakeTour === undefined ? {} : { onTakeTour: guide.onTakeTour }),
    ...(accountUrl === undefined ? {} : { accountUrl }),
    ...(isArgoAllowed
      ? {
          onSignInAsArgo: () => {
            setIsSigningInAsArgo(true);
            postTo('/sign-in/argo');
          },
        }
      : {}),
    isSigningInAsArgo,
  };
}
