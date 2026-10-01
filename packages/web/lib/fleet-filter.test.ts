import { idSchema, type ListedShip } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FLEET_VIEW,
  filterFleet,
  fleetTypes,
  fleetViewParams,
  readFleetView,
  retiredCount,
  type FleetView,
} from './fleet-filter';

let nextId = 0;
const ID_CHARACTERS = '0123456789abcdefghjkmnpqrstvwxyz';

function aShip(overrides: Partial<ListedShip> & Pick<ListedShip, 'name'>): ListedShip {
  nextId += 1;
  return {
    id: idSchema('ship').parse(`shp_01m3tbfspe96yf1rnr4ank9h${ID_CHARACTERS.charAt(nextId % ID_CHARACTERS.length)}a`),
    type: 'builder',
    kind: 'agent',
    status: 'crewed',
    startingPrompt: null,
    location: { kind: 'DEVICE', description: null },
    ...overrides,
  };
}

const argo = aShip({ name: 'argo', type: 'operator', kind: 'operator' });
const reviewer = aShip({ name: 'reviewer-01', type: 'reviewer' });
const builder = aShip({ name: 'builder-web', status: 'awaitingCrew', location: null });
const retired = aShip({ name: 'old-bot', type: 'triage', status: 'retired', location: null });
const fleet = [reviewer, retired, builder, argo];

function view(changes: Partial<FleetView['filters']> & { query?: string }): FleetView {
  const { query = '', ...filters } = changes;
  return { query, filters: { ...DEFAULT_FLEET_VIEW.filters, ...filters } };
}

function names(ships: readonly ListedShip[]): string[] {
  return ships.map((ship) => ship.name);
}

describe('filterFleet', () => {
  it('pins argo first and orders the other ships by name', () => {
    expect(names(filterFleet(fleet, DEFAULT_FLEET_VIEW))).toEqual(['argo', 'builder-web', 'reviewer-01']);
  });

  it('hides retired ships until Show retired is on', () => {
    expect(names(filterFleet(fleet, view({ isRetiredShown: true })))).toContain('old-bot');
  });

  it('matches the search on name or type, ignoring case', () => {
    expect(names(filterFleet(fleet, view({ query: 'REVIEW' })))).toEqual(['reviewer-01']);
    expect(names(filterFleet(fleet, view({ query: 'builder' })))).toEqual(['builder-web']);
  });

  it('applies the search to argo like any ship', () => {
    expect(names(filterFleet(fleet, view({ query: 'web' })))).toEqual(['builder-web']);
  });

  it('filters by status', () => {
    expect(names(filterFleet(fleet, view({ status: 'awaitingCrew' })))).toEqual(['builder-web']);
  });

  it('filters by type', () => {
    expect(names(filterFleet(fleet, view({ type: 'reviewer' })))).toEqual(['reviewer-01']);
  });

  it('keeps the order when a ship changes, so rows never move under the pointer', () => {
    const changed = fleet.map((ship) => (ship === builder ? { ...ship, status: 'crewed' as const } : ship));
    expect(names(filterFleet(changed, DEFAULT_FLEET_VIEW))).toEqual(['argo', 'builder-web', 'reviewer-01']);
  });
});

describe('fleetTypes', () => {
  it('lists each type once, sorted, without retired ships unless they are shown', () => {
    expect(fleetTypes(fleet, false)).toEqual(['builder', 'operator', 'reviewer']);
    expect(fleetTypes(fleet, true)).toEqual(['builder', 'operator', 'reviewer', 'triage']);
  });
});

describe('retiredCount', () => {
  it('counts the retired ships', () => {
    expect(retiredCount(fleet)).toBe(1);
  });
});

describe('the view in the URL', () => {
  it('leaves every default out', () => {
    expect(fleetViewParams(DEFAULT_FLEET_VIEW).toString()).toBe('');
  });

  it('reads back what it wrote', () => {
    const written = view({ query: 'rev', status: 'crewed', type: 'reviewer', isRetiredShown: true });
    expect(readFleetView(fleetViewParams(written))).toEqual(written);
  });

  it('falls back to the default for a status it does not know', () => {
    expect(readFleetView(new URLSearchParams('status=sailing')).filters.status).toBe('all');
  });
});
