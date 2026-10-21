'use client';

import { appSwitcherOf, type AppSwitcherModel } from '@aeolus-fleet/common/header';
import { useQuery } from '@tanstack/react-query';

import { fetchConsoleRead } from './fetch-console-read';
import { useTRPC } from './trpc';

/** The apps list's query key: one read per page load, shared by the header, the avatar menu and the palette. */
export const APPS_LIST_KEY = ['apps-list'] as const;

/** The apps and fleets the signed-in account may open (lib/apps-list.ts); null while pagasae gives none. */
export function useAppsList() {
  return useQuery({ queryKey: APPS_LIST_KEY, queryFn: () => fetchConsoleRead({ read: 'apps-list' }) });
}

/**
 * The switcher in the header's title (header design H1, H8, H9): this
 * console's fleet, by the name console.session gives it, and the apps and
 * fleets the account may open; the console and its own fleet alone without
 * the list. Undefined until the session is read.
 */
export function useAppSwitcher(): AppSwitcherModel | undefined {
  const trpc = useTRPC();
  const session = useQuery(trpc.console.session.queryOptions());
  const list = useAppsList();
  if (session.data === undefined) {
    return undefined;
  }
  return appSwitcherOf({ list: list.data ?? undefined, fleet: { id: session.data.fleetId, name: session.data.fleetName }, app: 'console' });
}
