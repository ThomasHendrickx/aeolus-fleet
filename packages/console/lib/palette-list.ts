import type { PaletteList } from '@aeolus-fleet/common';

type Entry = PaletteList['entries'][number];

/**
 * The console's palette list (docs/design/header-across-apps.md, A1; header
 * design H4): the actions and pages its own palette offers, with the scope
 * each needs, and no data: no ships, no squadrons. Form squadron and
 * Squadrons only where the console has squadrons. An action is a deep link:
 * the console checks the rights on arrival and opens its dialog.
 */
export function consolePaletteListOf(input: { hasSquadrons: boolean }): PaletteList {
  const { hasSquadrons } = input;
  return {
    app: 'console',
    entries: [
      { kind: 'action', key: 'commission', label: 'Commission ship', path: '/?commission=new', keywords: ['ship'], rights: ['fleet:commission'], icon: 'plus' },
      ...(hasSquadrons ? [{ kind: 'action', key: 'form-squadron', label: 'Form squadron', path: '/squadrons?form=new', keywords: [], rights: ['fleet:manage'], icon: 'users' } satisfies Entry] : []),
      { kind: 'action', key: 'compose', label: 'Compose a message', path: '/?compose=new', keywords: ['send'], rights: ['messages:send'], icon: 'send' },
      { kind: 'page', key: 'overview', label: 'Fleet overview', path: '/', keywords: ['ships', 'fleet'], rights: ['fleet:read'], icon: 'ship' },
      ...(hasSquadrons ? [{ kind: 'page', key: 'squadrons', label: 'Squadrons', path: '/squadrons', keywords: [], rights: ['fleet:read'], icon: 'users' } satisfies Entry] : []),
      { kind: 'page', key: 'inbox', label: 'Operator inbox', path: '/inbox', keywords: [], rights: ['fleet:read'], icon: 'inbox' },
      { kind: 'page', key: 'health', label: 'Health', path: '/fleet-health', keywords: [], rights: ['fleet:read'], icon: 'activity' },
    ],
  };
}
