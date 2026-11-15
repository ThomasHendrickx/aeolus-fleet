import type { PaletteList } from '@aeolus-fleet/common';
import type { PaletteIcon } from '@aeolus-fleet/common/rules';

import type { SidebarDestination } from '../components/organisms/sidebar';
import { navigationWith } from './console-navigation';

type Entry = PaletteList['entries'][number];

/** The icon each page of the navigation shows in another app's palette. */
const PAGE_ICONS: Record<SidebarDestination, PaletteIcon> = {
  overview: 'ship',
  health: 'activity',
  'needs-crew': 'users',
  squadrons: 'users',
  trierarchs: 'ship',
  usage: 'activity',
  inbox: 'inbox',
  network: 'network',
  settings: 'settings',
};

/**
 * The console's palette list (docs/design/header-across-apps.md, A1; header
 * design H4): the actions its own palette offers and every page of its
 * navigation (CONSOLE_NAVIGATION), with the scope each needs, and no data:
 * no ships, no squadrons. Form squadron and Squadrons only where the console
 * has squadrons, Trierarchs and Usage only where it has the trierarch plugin.
 * An action is a deep link: the console checks the rights on arrival and
 * opens its dialog.
 */
export function consolePaletteListOf(plugins: { hasSquadrons: boolean; hasTrierarchs: boolean }): PaletteList {
  const actions: Entry[] = [
    { kind: 'action', key: 'commission', label: 'Commission ship', path: '/?commission=new', keywords: ['ship'], rights: ['fleet:manage'], icon: 'plus' },
    ...(plugins.hasSquadrons ? [{ kind: 'action', key: 'form-squadron', label: 'Form squadron', path: '/squadrons?form=new', keywords: [], rights: ['fleet:manage'], icon: 'users' } satisfies Entry] : []),
    { kind: 'action', key: 'compose', label: 'Compose a message', path: '/?compose=new', keywords: ['send'], rights: ['messages:send'], icon: 'send' },
  ];
  const pages = navigationWith(plugins).map(({ destination, label, path, rights }): Entry => ({ kind: 'page', key: destination, label, path, keywords: [], rights: [...rights], icon: PAGE_ICONS[destination] }));
  return { app: 'console', entries: [...actions, ...pages] };
}
