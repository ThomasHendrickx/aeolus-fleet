'use client';

import { usePathname } from 'next/navigation';

import type { SidebarDestination } from '../../components/organisms/sidebar';
import { LoadingSkeleton } from '../../components/molecules/loading-skeleton';
import { ListPage } from '../../components/organisms/list-page';
import { destinationOf, useConsoleFrame } from '../../lib/console-frame';

/** Each navigation destination's page title, as its page heads itself. */
const TITLES: Record<SidebarDestination, string> = {
  overview: 'Fleet overview',
  'needs-crew': 'Needs crew',
  squadrons: 'Squadrons',
  trierarchs: 'Trierarchs',
  inbox: 'Inbox',
  health: 'Health',
  network: 'Network',
  settings: 'Settings',
};

/**
 * The loading state of a signed-in page (docs/design/conventions.md,
 * "Loading"): shown at once on a click, while the web app's server answers,
 * so a slow server never leaves a click without an answer. It keeps the
 * chrome and the heading of the page's destination and stands a table
 * skeleton in for the content; the live dot says the live updates connect.
 */
export function ConsoleLoading() {
  const frame = useConsoleFrame();
  return (
    <ListPage {...frame} title={TITLES[destinationOf(usePathname())]} live="reconnecting">
      <LoadingSkeleton variant="table" />
    </ListPage>
  );
}
