'use client';

import type { AppsList, ConsoleSessionOutput, HeaderApp } from '@aeolus-fleet/common';
import { appSwitcherOf, type AppSwitcherModel } from '@aeolus-fleet/common/rules';
import type { AppAccess, AppsAndFleetsState } from '@aeolus-fleet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useHasAccountApp } from './account-app-client';
import type { AppsListRead } from './apps-list-read';
import { fetchConsoleRead } from './fetch-console-read';
import { useFleetSwitch } from './fleet-switch';
import { useTRPC } from './trpc';

/** The apps list's query key: one read per page load, shared by the bar, Settings and the palette. */
export const APPS_LIST_KEY = ['apps-list'] as const;

/**
 * Whether this console sign-in is an account's own (accounts design C1): only
 * then is the account app's list the signed-in human's to show. argo's sign-in and the
 * viewer's are not (header design H8), even where the browser carries the
 * shared sign-in, as a sign-in as argo from the account app does.
 */
export function isAccountSignIn(kind: ConsoleSessionOutput['kind']): boolean {
  switch (kind) {
    case 'operator':
    case 'viewer':
      return false;
    case 'account':
      return true;
  }
}

/** The apps list as the bar holds it: the list, none, or the shared sign-in ended, with the list held before it ended. */
type HeldAppsList = Exclude<AppsListRead, { kind: 'ended' }> | { kind: 'ended'; list?: AppsList };

/** Where the read of the apps list stands, as the panel shows it. */
export interface AppsListReadState {
  answer: HeldAppsList | undefined;
  isFetching: boolean;
  isFailed: boolean;
  /** Try again was pressed on this page. */
  hasRetried: boolean;
}

/** What the panel shows of the apps list for this sign-in, the list it offers, and whether the account's sign-in expired. */
export interface AppsAndFleetsView {
  state: Pick<AppsAndFleetsState, 'read' | 'limit' | 'appAccess'>;
  list: AppsList | undefined;
  isSignInExpired: boolean;
}

/** Every app of the list but the console, as each needs sign-in again. */
function signInRequiredOf(list: AppsList): Partial<Record<HeaderApp, AppAccess>> {
  const apps = [...list.fleets.flatMap((fleet) => fleet.apps), ...list.apps].map((link) => link.app).filter((app) => app !== 'console');
  return Object.fromEntries(apps.map((app) => [app, 'sign-in-required' as const]));
}

/**
 * The Apps and fleets panel's state from the apps-list read
 * (docs/design/app-navigation, section 4): argo's and the viewer's sign-ins
 * reach Console alone and say why, and so does argo's on an installation
 * without the account app (single-app). An account's list shows tile and row
 * shapes while it is read, says it could not load it with Try again, is busy
 * while Try again reads, and says it refreshed it. Once the account app says
 * the sign-in ended, every other app of the list held needs sign-in and the
 * account button says the sign-in expired.
 */
export function appsAndFleetsStateOf(input: { signedInAs: ConsoleSessionOutput['kind']; hasAccountApp: boolean; read: AppsListReadState }): AppsAndFleetsView {
  const { signedInAs, hasAccountApp, read } = input;
  if (signedInAs === 'viewer') {
    return { state: { read: 'loaded', limit: 'viewer' }, list: undefined, isSignInExpired: false };
  }
  if (signedInAs === 'operator') {
    return { state: { read: 'loaded', limit: hasAccountApp ? 'argo' : 'single-app' }, list: undefined, isSignInExpired: false };
  }
  if (read.isFailed) {
    return { state: { read: read.isFetching ? 'retrying' : 'failed' }, list: undefined, isSignInExpired: false };
  }
  const shown = read.hasRetried ? 'refreshed' : 'loaded';
  switch (read.answer?.kind) {
    case undefined:
      return { state: { read: 'loading' }, list: undefined, isSignInExpired: false };
    case 'none':
      return { state: { read: shown, limit: 'single-app' }, list: undefined, isSignInExpired: false };
    case 'list':
      return { state: { read: shown }, list: read.answer.list, isSignInExpired: false };
    case 'ended': {
      const { list } = read.answer;
      return list === undefined ? { state: { read: shown }, list, isSignInExpired: true } : { state: { read: shown, appAccess: signInRequiredOf(list) }, list, isSignInExpired: true };
    }
  }
}

/**
 * The apps-list read (lib/apps-list.ts), asked only for an account's own
 * sign-in, once per page load: each read costs the account app a core read
 * per fleet (#1117). An answer that the sign-in ended keeps the list held
 * before it, so the panel can say which apps need sign-in.
 */
function useAppsListRead(isForAccount: boolean) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: APPS_LIST_KEY,
    queryFn: async (): Promise<HeldAppsList> => {
      const answer = await fetchConsoleRead({ read: 'apps-list' });
      if (answer.kind !== 'ended') {
        return answer;
      }
      const held = queryClient.getQueryData<HeldAppsList>(APPS_LIST_KEY);
      const list = held?.kind === 'list' || held?.kind === 'ended' ? held.list : undefined;
      return list === undefined ? { kind: 'ended' } : { kind: 'ended', list };
    },
    enabled: isForAccount,
    staleTime: Infinity,
    // The panel says it could not load them and offers Try again.
    retry: false,
  });
}

/**
 * The apps and fleets the signed-in account may open (lib/apps-list.ts), read
 * only for an account's own sign-in; none otherwise, and while the account app gives
 * none.
 */
export function useAppsList(): AppsList | undefined {
  const trpc = useTRPC();
  const session = useQuery(trpc.console.session.queryOptions());
  const isForAccount = session.data !== undefined && isAccountSignIn(session.data.kind);
  const read = useAppsListRead(isForAccount);
  return isForAccount && read.data?.kind === 'list' ? read.data.list : undefined;
}

/** Whether the apps list is read, or not asked, as for argo's and the viewer's sign-ins: Settings waits for it, as it names Your account. */
export function useIsAppsListRead(): boolean {
  const trpc = useTRPC();
  const session = useQuery(trpc.console.session.queryOptions());
  const isForAccount = session.data !== undefined && isAccountSignIn(session.data.kind);
  const read = useAppsListRead(isForAccount);
  return !isForAccount || !read.isPending;
}

/**
 * Whether the apps list allows the account as argo of the fleet the console
 * shows (accounts design, A7): Settings reads it from the list the bar
 * already holds, so a page load asks the account app once (#1117).
 */
export function isArgoAllowedIn(list: AppsList | undefined, fleetId: string | undefined): boolean {
  return list?.fleets.some((fleet) => fleet.id === fleetId && fleet.argo) ?? false;
}

/** What the bar shows of the apps and fleets: the switcher, its state and handlers, and whether the account's sign-in expired. */
export interface ConsoleSwitcher {
  /** Undefined until the session is read. */
  switcher: AppSwitcherModel | undefined;
  switcherState: AppsAndFleetsState;
  isSignInExpired: boolean;
}

/**
 * The bar's Apps and fleets (docs/design/app-navigation, section 4; header
 * design H1, H8, H9): this console's fleet, by the name console.session
 * gives it, and the apps and fleets an account may open, with the read's
 * state; Try again reads the list again, Sign in goes to the existing
 * shared sign-in, back to this page, and a fleet chosen opens as
 * useFleetSwitch says.
 */
export function useAppSwitcher(): ConsoleSwitcher {
  const trpc = useTRPC();
  const session = useQuery(trpc.console.session.queryOptions());
  const hasAccountApp = useHasAccountApp();
  const isForAccount = session.data !== undefined && isAccountSignIn(session.data.kind);
  const read = useAppsListRead(isForAccount);
  const [hasRetried, setHasRetried] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const { fleetSwitch, onOpenFleet } = useFleetSwitch();
  if (session.data === undefined) {
    return { switcher: undefined, switcherState: { read: 'loading' }, isSignInExpired: false };
  }
  const view = appsAndFleetsStateOf({
    signedInAs: session.data.kind,
    hasAccountApp,
    read: { answer: read.data, isFetching: read.isFetching, isFailed: read.isError, hasRetried },
  });
  return {
    switcher: appSwitcherOf({ list: view.list, fleet: { id: session.data.fleetId, name: session.data.fleetName }, app: 'console' }),
    switcherState: {
      ...view.state,
      ...(fleetSwitch === undefined ? {} : { fleetSwitch }),
      onOpenFleet,
      onRetry: () => {
        setHasRetried(true);
        void read.refetch();
      },
      ...(view.isSignInExpired
        ? {
            onSignIn: () => {
              setIsSigningIn(true);
              window.location.assign(`/sign-in/start?returnTo=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`);
            },
            isSigningIn,
          }
        : {}),
    },
    isSignInExpired: view.isSignInExpired,
  };
}
