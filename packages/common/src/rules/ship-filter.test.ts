import { describe, expect, it } from 'vitest';

import { createIdGenerator } from '../ids/index.js';
import { matchesShipFilter, statusesAsked, type FilteredShip } from './ship-filter.js';

const newId = createIdGenerator();

function aShip(ship: Partial<FilteredShip>): FilteredShip {
  return { id: newId('ship'), name: 'builder', type: 'builder', kind: 'agent', status: 'crewed', harness: null, labels: [], crewRequest: null, ...ship };
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

describe('statusesAsked', () => {
  it('asks the active ships when no status is picked', () => {
    expect(statusesAsked(undefined)).toEqual(['awaitingCrew', 'crewed']);
  });
});
