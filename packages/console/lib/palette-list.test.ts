import { paletteListSchema } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { CONSOLE_NAVIGATION } from './console-navigation';
import { consolePaletteListOf } from './palette-list';

/** A list's pages as the navigation names them. */
function pagesOf(hasPlugins: { hasSquadrons: boolean; hasTrierarchs: boolean }) {
  return consolePaletteListOf(hasPlugins)
    .entries.filter((entry) => entry.kind === 'page')
    .map((entry) => ({ destination: entry.key, label: entry.label, path: entry.path, rights: entry.rights }));
}

describe("the console's palette list (header-across-apps A1)", () => {
  it('holds every page of the navigation, in its order, with the rights each needs', () => {
    // Given a console with squadrons and the trierarch plugin
    // When its list is served
    // Then its pages are the navigation's, every one of them
    expect(pagesOf({ hasSquadrons: true, hasTrierarchs: true })).toEqual(CONSOLE_NAVIGATION.map(({ destination, label, path, rights }) => ({ destination, label, path, rights })));
  });

  it('holds Needs crew, Network and Settings always, and Squadrons, Trierarchs and Usage only where the console has their plugin', () => {
    expect(CONSOLE_NAVIGATION.map((page) => page.destination)).toEqual(['overview', 'health', 'needs-crew', 'squadrons', 'trierarchs', 'usage', 'inbox', 'network', 'settings']);
    expect(pagesOf({ hasSquadrons: false, hasTrierarchs: false }).map((page) => page.destination)).toEqual(['overview', 'health', 'needs-crew', 'inbox', 'network', 'settings']);
  });

  it('gives each action the scope it needs: Compose messages:send, Commission ship and Form squadron fleet:manage', () => {
    const actions = consolePaletteListOf({ hasSquadrons: true, hasTrierarchs: false }).entries.filter((entry) => entry.kind === 'action');
    expect(actions.map(({ key, rights }) => ({ key, rights }))).toEqual([
      { key: 'commission', rights: ['fleet:manage'] },
      { key: 'form-squadron', rights: ['fleet:manage'] },
      { key: 'compose', rights: ['messages:send'] },
    ]);
  });

  it('reads as a palette list', () => {
    const list = consolePaletteListOf({ hasSquadrons: true, hasTrierarchs: true });
    expect(paletteListSchema.parse(list)).toEqual(list);
  });
});
