import { describe, expect, it } from 'vitest';

import { createIdGenerator } from '../ids/index.js';
import { matchesShipFilter, statusesAsked, type FilteredShip } from './ship-filter.js';

const newId = createIdGenerator();

function aShip(ship: Partial<FilteredShip>): FilteredShip {
  return { id: newId('ship'), name: 'builder', type: 'builder', kind: 'agent', status: 'crewed', harness: null, labels: [], crewRequest: null, report: null, openAlertCount: 0, ...ship };
}

describe('matchesShipFilter', () => {
  it('selects a ship whose name or type holds the search, in any case', () => {
    expect([aShip({ name: 'Scout-1' }), aShip({ type: 'SCOUT' }), aShip({})].map((ship) => matchesShipFilter(ship, { filter: { query: ' scout ' }, isInReach: true }))).toEqual([true, true, false]);
  });

  it('selects a ship of a picked status only', () => {
    expect(matchesShipFilter(aShip({ status: 'retired' }), { filter: { status: ['awaitingCrew', 'crewed'] }, isInReach: true })).toBe(false);
  });

  it('never selects a ship outside the read reach by what it does not show', () => {
    expect(matchesShipFilter(aShip({}), { filter: { kind: ['other'] }, isInReach: false })).toBe(false);
  });

  it('selects a ship on Needs crew only while its request waits for crew', () => {
    const waiting = aShip({ status: 'awaitingCrew', crewRequest: { assignedTo: null, crewedBy: null, status: null } });
    const running = aShip({ crewRequest: { assignedTo: { id: newId('ship') }, crewedBy: null, status: 'running' } });

    expect([waiting, running].map((ship) => matchesShipFilter(ship, { filter: { needsCrew: 'withTrierarchs' }, isInReach: true }))).toEqual([true, false]);
  });
});

// The overview's State filter (docs/design/fleet-overview, #1605): the list filtered by Harbour's state, as Thomas answered.
describe('matchesShipFilter by Harbour state', () => {
  it("selects a ship in any of the Harbour states picked, as harbourStateOf decides it", () => {
    const ships = [
      aShip({ openAlertCount: 1, report: { state: 'working' } }),
      aShip({ status: 'awaitingCrew' }),
      aShip({ report: { state: 'blocked' } }),
      aShip({ report: { state: 'working' } }),
      aShip({ report: { state: 'idle' } }),
      aShip({}),
    ];

    const selected = ships.map((ship) => matchesShipFilter(ship, { filter: { state: ['alert', 'waiting'] }, isInReach: true }));

    expect(selected).toEqual([true, true, true, false, false, false]);
  });

  it('never selects a retired ship by a state: Harbour holds none', () => {
    expect(matchesShipFilter(aShip({ status: 'retired' }), { filter: { state: ['idle'] }, isInReach: true })).toBe(false);
  });

  it('never selects a ship outside the read reach by its state: its report and alerts do not show', () => {
    expect(matchesShipFilter(aShip({}), { filter: { state: ['idle'] }, isInReach: false })).toBe(false);
  });
});

describe('statusesAsked', () => {
  it('asks the active ships when no status is picked', () => {
    expect(statusesAsked(undefined)).toEqual(['awaitingCrew', 'crewed']);
  });
});
