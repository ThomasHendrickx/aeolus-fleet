import { createIdGenerator, type HarbourOutput } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { harbourGroupsOf, harbourSummaryOf } from './harbour';

const newId = createIdGenerator();

type Tile = HarbourOutput['items'][number];

function aTile(name: string, { kind = 'agent', state = 'idle', note = null }: Partial<Omit<Tile, 'id' | 'name'>> = {}): Tile {
  return { id: newId('ship'), name, kind, state, note, lastActivityAt: null };
}

describe("harbourGroupsOf: Harbour's groups from the tiles fleet.harbour answers", () => {
  it('groups the tiles by kind: People (argo and person ships), Agents, Plugins, then Through the gateway (app ships), leaving out a kind with no ship', () => {
    const tiles = [aTile('sentry', { kind: 'app' }), aTile('trierarch', { kind: 'plugin' }), aTile('ada', { kind: 'person' }), aTile('argo', { kind: 'operator' }), aTile('linear', { kind: 'app' })];

    const groups = harbourGroupsOf(tiles).map((group) => ({ kind: group.kind, names: group.tiles.map((tile) => tile.name) }));

    expect(groups).toEqual([
      { kind: 'people', names: ['ada', 'argo'] },
      { kind: 'plugins', names: ['trierarch'] },
      { kind: 'gateway', names: ['linear', 'sentry'] },
    ]);
  });

  it('orders a group alerts first, then waiting, working and idle, each by name', () => {
    const tiles = [
      aTile('builder-ui'),
      aTile('walker-1', { state: 'working' }),
      aTile('builder-core', { state: 'working' }),
      aTile('walker-2', { state: 'waiting' }),
      aTile('reviewer', { state: 'alert' }),
    ];

    const names = harbourGroupsOf(tiles)[0]?.tiles.map((tile) => tile.name);

    expect(names).toEqual(['reviewer', 'walker-2', 'builder-core', 'walker-1', 'builder-ui']);
  });

  it('shows a ship once, where it first shows, when a live reload put it on a page that a later page also holds', () => {
    const scout = aTile('scout', { state: 'working' });

    const tiles = harbourGroupsOf([scout, aTile('builder'), { ...scout, state: 'idle' }])[0]?.tiles;

    expect(tiles?.map(({ name, state }) => ({ name, state }))).toEqual([
      { name: 'scout', state: 'working' },
      { name: 'builder', state: 'idle' },
    ]);
  });
});

// The overview's subtitle from Harbour's numbers (docs/design/fleet-overview): "19 ships: 8 working, 7 idle, 3 waiting, 1 with an alert".
describe("harbourSummaryOf: the overview's subtitle", () => {
  it('names the ships and each state they are in, working and idle first', () => {
    expect(harbourSummaryOf({ ships: 19, alert: 1, waiting: 3, working: 8, idle: 7 }, { canCommission: true })).toBe('19 ships: 8 working, 7 idle, 3 waiting, 1 with an alert');
  });

  it('leaves out a state no ship is in', () => {
    expect(harbourSummaryOf({ ships: 4, alert: 0, waiting: 0, working: 3, idle: 1 }, { canCommission: true })).toBe('4 ships: 3 working, 1 idle');
  });

  it('says what to do next while argo is alone, to those who may commission', () => {
    expect([harbourSummaryOf({ ships: 1, alert: 0, waiting: 0, working: 0, idle: 1 }, { canCommission: true }), harbourSummaryOf({ ships: 1, alert: 0, waiting: 0, working: 0, idle: 1 }, { canCommission: false })]).toEqual([
      'Only argo so far. Ships you commission appear here.',
      'Only argo so far.',
    ]);
  });
});
