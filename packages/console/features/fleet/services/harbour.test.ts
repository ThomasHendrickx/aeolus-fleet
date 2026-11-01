import { createIdGenerator, type ListedShip, type ShipOutsideReadReach } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { harbourOf } from './harbour';

const newId = createIdGenerator();

function aShip(name: string, overrides: Partial<ListedShip> = {}): ListedShip {
  return {
    id: newId('ship'), name, type: 'implementer', kind: 'agent', status: 'crewed', startingPrompt: null, location: null, lastSeenAt: null, ping: null,
    scopes: ['messages:send', 'messages:receive'], labels: [], report: null, harness: null, model: null, activity: null, openAlertCount: 0, awaitingCrewSince: null, crewRequest: null, retiredAt: null, ownerShipId: null,
    ...overrides,
  };
}

function aReport(state: NonNullable<ListedShip['report']>['state'], note: string | null = null): ListedShip['report'] {
  return { state, note, task: null, step: null, reportedAt: '2026-11-01T12:00:00.000Z', reportChangedAt: '2026-11-01T12:00:00.000Z', detailsVersion: 0 };
}

function outsideReadReach(name: string): ShipOutsideReadReach {
  return { id: newId('ship'), name, type: 'implementer', status: 'crewed', isInReadReach: false };
}

/** Each tile of the one group, as name and state. */
function tilesOf(ships: readonly ListedShip[]): { name: string; state: string }[] {
  return harbourOf(ships).groups.flatMap((group) => group.tiles.map(({ name, state }) => ({ name, state })));
}

describe('harbourOf: which state a ship lands in', () => {
  it('puts a ship with an open alert in Alert, whatever its status and report', () => {
    const ships = [aShip('reviewer', { openAlertCount: 1, report: aReport('working') }), aShip('walker', { openAlertCount: 2, status: 'awaitingCrew' })];

    const tiles = tilesOf(ships);

    expect(tiles).toEqual([
      { name: 'reviewer', state: 'alert' },
      { name: 'walker', state: 'alert' },
    ]);
  });

  it('puts a ship awaiting crew, and a crewed ship that reports blocked, in Waiting', () => {
    const ships = [aShip('walker-2', { status: 'awaitingCrew', report: null }), aShip('builder-gateway', { report: aReport('blocked', 'waiting for release 0.35.0') })];

    const tiles = tilesOf(ships);

    expect(tiles).toEqual([
      { name: 'builder-gateway', state: 'waiting' },
      { name: 'walker-2', state: 'waiting' },
    ]);
  });

  it('puts a crewed ship that reports working in Working', () => {
    const tiles = tilesOf([aShip('orchestrator-1', { report: aReport('working') })]);

    expect(tiles).toEqual([{ name: 'orchestrator-1', state: 'working' }]);
  });

  it('puts a crewed ship that reports idle, or has not reported yet, in Idle', () => {
    const tiles = tilesOf([aShip('builder-ui', { report: aReport('idle') }), aShip('builder-web', { report: null })]);

    expect(tiles).toEqual([
      { name: 'builder-ui', state: 'idle' },
      { name: 'builder-web', state: 'idle' },
    ]);
  });
});

describe('harbourOf: the numbers', () => {
  it('counts the ships shown and how many are in each state, leaving out retired ships, the viewer ship and ships outside read reach', () => {
    const ships = [
      aShip('argo', { kind: 'operator' }),
      aShip('console', { kind: 'viewer' }),
      aShip('reviewer', { openAlertCount: 1 }),
      aShip('walker-2', { status: 'awaitingCrew' }),
      aShip('builder-gateway', { report: aReport('blocked') }),
      aShip('builder-core', { report: aReport('working') }),
      aShip('old', { status: 'retired', retiredAt: '2026-10-01T00:00:00.000Z', report: aReport('working') }),
      outsideReadReach('elsewhere'),
    ];

    const { counts } = harbourOf(ships);

    expect(counts).toEqual({ ships: 5, alert: 1, waiting: 2, working: 1, idle: 1 });
  });
});

describe('harbourOf: the groups', () => {
  it('groups the ships by kind: People (argo and person ships), Agents, Plugins, then Through the gateway (app ships), leaving out a kind with no ship', () => {
    const ships = [aShip('sentry', { kind: 'app' }), aShip('trierarch', { kind: 'plugin' }), aShip('ada', { kind: 'person' }), aShip('argo', { kind: 'operator' }), aShip('linear', { kind: 'app' })];

    const groups = harbourOf(ships).groups.map((group) => ({ kind: group.kind, names: group.tiles.map((tile) => tile.name) }));

    expect(groups).toEqual([
      { kind: 'people', names: ['ada', 'argo'] },
      { kind: 'plugins', names: ['trierarch'] },
      { kind: 'gateway', names: ['linear', 'sentry'] },
    ]);
  });

  it('orders a group alerts first, then waiting, working and idle, each by name', () => {
    const ships = [
      aShip('builder-ui'),
      aShip('walker-1', { report: aReport('working') }),
      aShip('builder-core', { report: aReport('working') }),
      aShip('walker-2', { status: 'awaitingCrew' }),
      aShip('reviewer', { openAlertCount: 1 }),
    ];

    const names = harbourOf(ships).groups[0]?.tiles.map((tile) => tile.name);

    expect(names).toEqual(['reviewer', 'walker-2', 'builder-core', 'walker-1', 'builder-ui']);
  });

  it("gives each tile what its ship is doing: its report's note, none before it reports", () => {
    const ships = [aShip('orchestrator-1', { report: aReport('working', 'Splitting #1441 into tasks') }), aShip('walker-2', { status: 'awaitingCrew' })];

    const notes = harbourOf(ships).groups[0]?.tiles.map(({ name, note }) => ({ name, note }));

    expect(notes).toEqual([
      { name: 'walker-2', note: null },
      { name: 'orchestrator-1', note: 'Splitting #1441 into tasks' },
    ]);
  });
});
