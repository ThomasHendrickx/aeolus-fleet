'use client';

import type { ConsoleSessionOutput } from '@aeolus-fleet/common';
import { appSwitcherOf, type AppSwitcherModel } from '@aeolus-fleet/common/header';
import { useQuery } from '@tanstack/react-query';

import { fetchConsoleRead } from './fetch-console-read';
import { useTRPC } from './trpc';

/** The apps list's query key: one read per page load, shared by the header, the avatar menu and the palette. */
export const APPS_LIST_KEY = ['apps-list'] as const;

/**
 * Whether this console sign-in is an account's own (accounts design C1): only
 * then is pagasae's list the signed-in human's to show. argo's sign-in and the
 * viewer's are not (header design H8), even where the browser carries the
 * shared sign-in, as a hosted argo sign-in from pagasae does; and they are
 * the only kinds a console session has today.
 */
export function isAccountSignIn(kind: ConsoleSessionOutput['kind']): boolean {
  switch (kind) {
    case 'operator':
    case 'viewer':
      return false;
  }
}

/**
 * The apps and fleets the signed-in account may open (lib/apps-list.ts), read
 * only for an account's own sign-in; none otherwise, and while pagasae gives
 * none.
 */
export function useAppsList() {
  const trpc = useTRPC();
  const session = useQuery(trpc.console.session.queryOptions());
  const isForAccount = session.data !== undefined && isAccountSignIn(session.data.kind);
  const list = useQuery({ queryKey: APPS_LIST_KEY, queryFn: () => fetchConsoleRead({ read: 'apps-list' }), enabled: isForAccount });
  return isForAccount ? (list.data ?? undefined) : undefined;
}

/**
 * The switcher in the header's title (header design H1, H8, H9): this
 * console's fleet, by the name console.session gives it, and the apps and
 * fleets an account may open; the console and its own fleet alone without
 * the list. Undefined until the session is read.
 */
export function useAppSwitcher(): AppSwitcherModel | undefined {
  const trpc = useTRPC();
  const session = useQuery(trpc.console.session.queryOptions());
  const list = useAppsList();
  if (session.data === undefined) {
    return undefined;
  }
  return appSwitcherOf({ list, fleet: { id: session.data.fleetId, name: session.data.fleetName }, app: 'console' });
}
