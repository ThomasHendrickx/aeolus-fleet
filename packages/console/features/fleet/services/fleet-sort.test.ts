import { idSchema, type ListedShip } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { DEFAULT_FLEET_VIEW, filterFleet, fleetViewParams, type FilteredView, type FleetView } from './fleet-filter';
import { nextSort, type FleetSort } from './fleet-sort';
import { readFleetView } from './read-fleet-view';

let nextId = 0;
const ID_CHARACTERS = '0123456789abcdefghjkmnpqrstvwxyz';

function aShip(overrides: Partial<ListedShip> & Pick<ListedShip, 'name'>): ListedShip {
  nextId += 1;
  return {
    id: idSchema('ship').parse(`shp_01m3tbfspe96yf1rnr4ank9h${ID_CHARACTERS.charAt(nextId % ID_CHARACTERS.length)}b`),
    type: 'builder',
    kind: 'agent',
    status: 'crewed',
    startingPrompt: null,
    location: { kind: 'DEVICE', description: null },
    lastSeenAt: null,
    ping: null,
    scopes: ['messages:send', 'messages:receive'],
    report: null, harness: null, model: null, awaitingCrewSince: null, crewRequest: null, labels: [], retiredAt: null, ownerShipId: null,
    ...overrides,
  };
}

function aReport(note: string): ListedShip['report'] {
  return { state: 'working', note, reportedAt: '2026-10-14T08:00:00.000Z', detailsVersion: 0 };
}

function names(ships: readonly ListedShip[]): string[] {
  return ships.map((ship) => ship.name);
}

function sortedBy(ships: readonly ListedShip[], view: Partial<FilteredView> & { sort: FleetSort }): string[] {
  return names(filterFleet(ships, { ...DEFAULT_FLEET_VIEW, ...view }));
}

const argo = aShip({ name: 'argo', type: 'operator', kind: 'operator', harness: null });

describe('sorting the overview by a column', () => {
  const ships = [aShip({ name: 'beta' }), argo, aShip({ name: 'Alpha' }), aShip({ name: 'gamma' })];

  it('keeps argo first and the rest by name while no column is sorted', () => {
    expect(names(filterFleet(ships, DEFAULT_FLEET_VIEW))).toEqual(['argo', 'Alpha', 'beta', 'gamma']);
  });

  it('sorts by ship name from A to Z, argo among them, ignoring case', () => {
    expect(sortedBy(ships, { sort: { column: 'ship', direction: 'ascending' } })).toEqual(['Alpha', 'argo', 'beta', 'gamma']);
  });

  it('sorts by ship name from Z to A', () => {
    expect(sortedBy(ships, { sort: { column: 'ship', direction: 'descending' } })).toEqual(['gamma', 'beta', 'argo', 'Alpha']);
  });

  it('sorts by status as it reads: Awaiting crew, Crewed, Retired', () => {
    const fleet = [aShip({ name: 'a', status: 'retired' }), aShip({ name: 'b' }), aShip({ name: 'c', status: 'awaitingCrew' })];
    expect(sortedBy(fleet, { sort: { column: 'status', direction: 'ascending' }, filters: { ...DEFAULT_FLEET_VIEW.filters, isRetiredShown: true } })).toEqual(['c', 'b', 'a']);
  });

  it('sorts by report note, ships without a report last in both directions', () => {
    const fleet = [aShip({ name: 'quiet' }), aShip({ name: 'late', report: aReport('Writing tests') }), aShip({ name: 'early', report: aReport('Asking argo') })];
    expect(sortedBy(fleet, { sort: { column: 'report', direction: 'ascending' } })).toEqual(['early', 'late', 'quiet']);
    expect(sortedBy(fleet, { sort: { column: 'report', direction: 'descending' } })).toEqual(['late', 'early', 'quiet']);
  });

  it('sorts by squadron, then by the first label carried', () => {
    const LABEL = { labelId: idSchema('label').parse('lbl_01m3tbfspe96yf1rnr4ank9h0a'), valueId: idSchema('labelValue').parse('lbv_01m3tbfspe96yf1rnr4ank9h1a'), key: 'project', value: 'hemma' };
    const member = aShip({ name: 'member' });
    const labelled = aShip({ name: 'labelled', labels: [LABEL] });
    const bare = aShip({ name: 'bare' });
    const squadronsOf = new Map([[member.id, { squadronId: 'docs-x7q2w9', role: 'writer' }]]);
    expect(sortedBy([bare, labelled, member], { sort: { column: 'squadronAndLabels', direction: 'ascending' }, squadronsOf })).toEqual(['member', 'labelled', 'bare']);
  });

  it('sorts by what a ship runs on: its harness, argo as the console', () => {
    const fleet = [aShip({ name: 'codex-bot', harness: 'codex' }), argo, aShip({ name: 'claude-bot', harness: 'claude-code' }), aShip({ name: 'idle', status: 'awaitingCrew', location: null })];
    expect(sortedBy(fleet, { sort: { column: 'runsOn', direction: 'ascending' } })).toEqual(['claude-bot', 'codex-bot', 'argo', 'idle']);
  });

  it('sorts by when a ship was last seen, the most recent first, never seen last', () => {
    const fleet = [aShip({ name: 'old', lastSeenAt: '2026-10-13T08:00:00.000Z' }), aShip({ name: 'never' }), aShip({ name: 'new', lastSeenAt: '2026-10-14T08:00:00.000Z' })];
    expect(sortedBy(fleet, { sort: { column: 'seen', direction: 'ascending' } })).toEqual(['new', 'old', 'never']);
    expect(sortedBy(fleet, { sort: { column: 'seen', direction: 'descending' } })).toEqual(['old', 'new', 'never']);
  });

  it('breaks a tie by name', () => {
    const fleet = [aShip({ name: 'b', harness: 'codex' }), aShip({ name: 'a', harness: 'codex' })];
    expect(sortedBy(fleet, { sort: { column: 'runsOn', direction: 'descending' } })).toEqual(['a', 'b']);
  });
});

describe('nextSort', () => {
  it('sorts a column A to Z on the first click, Z to A on the second, and back to the default on the third', () => {
    const ascending = nextSort(null, 'status');
    expect(ascending).toEqual({ column: 'status', direction: 'ascending' });
    const descending = nextSort(ascending, 'status');
    expect(descending).toEqual({ column: 'status', direction: 'descending' });
    expect(nextSort(descending, 'status')).toBeNull();
  });

  it('starts A to Z when another column is clicked', () => {
    expect(nextSort({ column: 'ship', direction: 'descending' }, 'seen')).toEqual({ column: 'seen', direction: 'ascending' });
  });
});

describe('the sort in the URL', () => {
  it('leaves the default order out', () => {
    expect(fleetViewParams(DEFAULT_FLEET_VIEW).toString()).toBe('');
  });

  it('reads back what it wrote', () => {
    const written: FleetView = { ...DEFAULT_FLEET_VIEW, sort: { column: 'runsOn', direction: 'descending' } };
    expect(fleetViewParams(written).toString()).toBe('sort=runsOn&order=desc');
    expect(readFleetView(fleetViewParams(written))).toEqual(written);
  });

  it('falls back to the default order for a column it does not know', () => {
    expect(readFleetView(new URLSearchParams('sort=crew&order=desc')).sort).toBeNull();
  });
});
