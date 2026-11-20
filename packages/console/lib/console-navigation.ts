import type { Scope } from '@aeolus-fleet/common';

import type { SidebarDestination } from '../components/organisms/sidebar';

/** A plugin a page comes with: the page shows only where the console has it. */
export type NavigationPlugin = 'squadrons' | 'trierarchs';

/** A page of the console's navigation: where it goes and the scope a session needs to see it. */
export interface NavigationPage {
  destination: SidebarDestination;
  label: string;
  path: string;
  rights: readonly Scope[];
  plugin?: NavigationPlugin;
}

/**
 * The console's navigation, in the Sidebar's order: the one list the Sidebar
 * shows and the console's palette list serves (header-across-apps A1).
 */
export const CONSOLE_NAVIGATION: readonly NavigationPage[] = [
  { destination: 'overview', label: 'Fleet overview', path: '/', rights: ['fleet:read'] },
  { destination: 'health', label: 'Health', path: '/fleet-health', rights: ['fleet:read'] },
  { destination: 'needs-crew', label: 'Needs crew', path: '/needs-crew', rights: ['fleet:read'] },
  { destination: 'squadrons', label: 'Squadrons', path: '/squadrons', rights: ['fleet:read'], plugin: 'squadrons' },
  { destination: 'trierarchs', label: 'Trierarchs', path: '/trierarchs', rights: ['fleet:read'], plugin: 'trierarchs' },
  { destination: 'usage', label: 'Usage', path: '/usage', rights: ['fleet:read'], plugin: 'trierarchs' },
  { destination: 'inbox', label: 'Operator inbox', path: '/inbox', rights: ['fleet:read'] },
  // Network shows for a session holding fleet:network (usePluginNav); Settings for every sign-in (docs/design/app-navigation).
  { destination: 'network', label: 'Network', path: '/network', rights: ['fleet:network'] },
  { destination: 'settings', label: 'Settings', path: '/settings', rights: ['fleet:read'] },
];

/** The navigation's pages a console with these plugins has. */
export function navigationWith(plugins: { hasSquadrons: boolean; hasTrierarchs: boolean }): NavigationPage[] {
  return CONSOLE_NAVIGATION.filter(({ plugin }) => plugin === undefined || (plugin === 'squadrons' ? plugins.hasSquadrons : plugins.hasTrierarchs));
}
