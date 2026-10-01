import { createIdGenerator } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { paletteGroups, paletteItemsOf, paletteKeyOf, SHIPS_BEFORE_QUERY, type PaletteItem } from './command-palette';

const newId = createIdGenerator();

const compose: PaletteItem = { kind: 'action', id: 'compose', label: 'Compose message' };
const commission: PaletteItem = { kind: 'action', id: 'commission', label: 'Commission ship' };
const overview: PaletteItem = { kind: 'page', id: 'overview', label: 'Fleet overview', href: '/' };
const inbox: PaletteItem = { kind: 'page', id: 'inbox', label: 'Operator inbox', href: '/inbox' };

function aShip(name: string, type: string): PaletteItem {
  const id = newId('ship');
  return { kind: 'ship', id, name, type, status: 'crewed', href: `/ships/${id}` };
}

const reviewer = aShip('reviewer-01', 'reviewer');
const tester = aShip('tester-01', 'tester');
const items = [compose, commission, reviewer, tester, overview, inbox];

function labels(query: string) {
  return paletteGroups(items, query).map((group) => [group.label, group.items.map(paletteKeyOf)]);
}

describe('paletteGroups', () => {
  it('shows every group in order with no query: Actions, Ships, Go to', () => {
    expect(paletteGroups(items, '').map((group) => group.label)).toEqual(['Actions', 'Ships', 'Go to']);
  });

  it('finds a ship by its name or its type, in any case', () => {
    expect(labels('REVI')).toEqual([['Ships', [paletteKeyOf(reviewer)]]]);
    expect(labels('tester')).toEqual([['Ships', [paletteKeyOf(tester)]]]);
  });

  it('finds actions and pages by their label, and leaves out groups with no match', () => {
    expect(labels('inbox')).toEqual([['Go to', [paletteKeyOf(inbox)]]]);
    expect(labels('ship')).toEqual([['Actions', [paletteKeyOf(commission)]]]);
  });

  it('shows nothing when nothing matches', () => {
    expect(paletteGroups(items, 'deploy')).toEqual([]);
  });

  it('caps the ships before the operator types, and lists every match after', () => {
    const many = Array.from({ length: SHIPS_BEFORE_QUERY + 2 }, (_, index) => aShip(`ship-${String(index)}`, 'reviewer'));

    expect(paletteGroups(many, '')[0]?.items).toHaveLength(SHIPS_BEFORE_QUERY);
    expect(paletteGroups(many, 'ship')[0]?.items).toHaveLength(SHIPS_BEFORE_QUERY + 2);
  });

  it('ignores spaces around the query', () => {
    expect(labels('  revi ')).toEqual([['Ships', [paletteKeyOf(reviewer)]]]);
  });
});

describe('paletteItemsOf', () => {
  it('offers the actions, the active agent ships, never argo or a retired ship, and the pages', () => {
    const ships = [
      { id: newId('ship'), name: 'argo', type: 'operator', kind: 'operator', status: 'crewed', startingPrompt: null, location: null },
      { id: newId('ship'), name: 'reviewer-01', type: 'reviewer', kind: 'agent', status: 'crewed', startingPrompt: null, location: null },
      { id: newId('ship'), name: 'old', type: 'reviewer', kind: 'agent', status: 'retired', startingPrompt: null, location: null },
    ] as const;

    expect(paletteItemsOf(ships).map((item) => (item.kind === 'ship' ? item.name : item.id))).toEqual([
      'commission',
      'compose',
      'reviewer-01',
      'overview',
      'inbox',
      'attention',
    ]);
  });
});
