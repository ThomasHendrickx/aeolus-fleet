import { createIdGenerator, type HarbourOutput } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { harbourGroupsOf, harbourSummaryOf } from './harbour';

const newId = createIdGenerator();

type Tile = HarbourOutput['items'][number];

function aTile(name: string, { kind = 'agent', state = 'idle', note = null, lastActivityAt = null }: Partial<Omit<Tile, 'id' | 'name'>> = {}): Tile {
  return { id: newId('ship'), name, kind, state, note, lastActivityAt };
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

  // Thomas, #1605: state, then last activity newest first, then name; a ship that never did anything last in its state.
  it('orders a state by last activity, newest first, then by name, a ship that never did anything last', () => {
    const tiles = [
      aTile('walker-3', { state: 'awaitingCrew' }),
      aTile('aeolus-fleet-infra', { state: 'working', lastActivityAt: '2026-11-03T11:56:00.000Z' }),
      aTile('mac-mini', { state: 'working', lastActivityAt: '2026-11-03T11:59:00.000Z' }),
      aTile('orchestrator-1', { state: 'working', lastActivityAt: '2026-11-03T12:00:00.000Z' }),
      aTile('design-bridge-fleet', { state: 'working', lastActivityAt: '2026-11-03T12:00:00.000Z' }),
      aTile('builder-gateway', { state: 'awaitingCrew', lastActivityAt: '2026-11-03T11:35:00.000Z' }),
    ];

    const names = harbourGroupsOf(tiles)[0]?.tiles.map((tile) => tile.name);

    expect(names).toEqual(['builder-gateway', 'walker-3', 'design-bridge-fleet', 'orchestrator-1', 'mac-mini', 'aeolus-fleet-infra']);
  });

  it('orders a group alerts first, then awaiting crew, blocked, working and idle, each by name', () => {
    const tiles = [
      aTile('builder-ui'),
      aTile('walker-1', { state: 'working' }),
      aTile('builder-core', { state: 'working' }),
      aTile('walker-2', { state: 'awaitingCrew' }),
      aTile('planner', { state: 'blocked' }),
      aTile('reviewer', { state: 'alert' }),
    ];

    const names = harbourGroupsOf(tiles)[0]?.tiles.map((tile) => tile.name);

    expect(names).toEqual(['reviewer', 'walker-2', 'planner', 'builder-core', 'walker-1', 'builder-ui']);
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

// The overview's subtitle from Harbour's numbers (docs/design/fleet-overview): "19 ships: 8 working, 7 idle, 2 awaiting crew, 1 blocked, 1 with an alert".
describe("harbourSummaryOf: the overview's subtitle", () => {
  it('names the ships and each state they are in, working and idle first', () => {
    expect(harbourSummaryOf({ ships: 19, alert: 1, awaitingCrew: 2, blocked: 1, working: 8, idle: 7 }, { canCommission: true })).toBe('19 ships: 8 working, 7 idle, 2 awaiting crew, 1 blocked, 1 with an alert');
  });

  it('leaves out a state no ship is in', () => {
    expect(harbourSummaryOf({ ships: 4, alert: 0, awaitingCrew: 0, blocked: 0, working: 3, idle: 1 }, { canCommission: true })).toBe('4 ships: 3 working, 1 idle');
  });

  it('says what to do next while argo is alone, to those who may commission', () => {
    expect([harbourSummaryOf({ ships: 1, alert: 0, awaitingCrew: 0, blocked: 0, working: 0, idle: 1 }, { canCommission: true }), harbourSummaryOf({ ships: 1, alert: 0, awaitingCrew: 0, blocked: 0, working: 0, idle: 1 }, { canCommission: false })]).toEqual([
      'Only argo so far. Ships you commission appear here.',
      'Only argo so far.',
    ]);
  });
});
