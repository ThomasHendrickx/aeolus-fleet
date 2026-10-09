import { idSchema, type ListedShip } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import {
  activeFilterCount,
  activeFilterLabels,
  DEFAULT_FLEET_VIEW,
  filterFleet,
  fleetSquadrons,
  fleetTypes,
  fleetViewParams,
  readFleetView,
  retiredCount,
  urlParamsOf,
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
    lastSeenAt: null,
    ping: null,
    scopes: ['messages:send', 'messages:receive'],
    report: null, harness: null, model: null, awaitingCrewSince: null, crewRequest: null, labels: [], retiredAt: null,
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

describe('the squadron filter', () => {
  const squadronsOf = new Map([
    [reviewer.id, { squadronId: 'team-a1b2c3', role: null }],
    [builder.id, { squadronId: 'team-a1b2c3', role: 'builder' }],
  ]);

  it("keeps the squadron's flagship and members only", () => {
    expect(names(filterFleet(fleet, { ...view({ squadron: 'team-a1b2c3' }), squadronsOf }))).toEqual(['builder-web', 'reviewer-01']);
  });

  it('keeps every ship while it is all', () => {
    expect(names(filterFleet(fleet, { ...DEFAULT_FLEET_VIEW, squadronsOf }))).toEqual(['argo', 'builder-web', 'reviewer-01']);
  });

  it('lists each squadron once, sorted', () => {
    expect(fleetSquadrons(new Map([...squadronsOf, [argo.id, { squadronId: 'docs-x7q2w9', role: 'writer' }]]))).toEqual(['docs-x7q2w9', 'team-a1b2c3']);
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

describe('the crew request filter (#245)', () => {
  const requested = aShip({ name: 'scout', status: 'awaitingCrew', crewRequest: { settingsVersion: 1, requestedAt: '2026-10-07T10:00:00.000Z', assignedTo: null, status: null, reason: null, crewedBy: null, attempt: 0, startedAt: null, givenBack: [] } });

  it('keeps the ships whose crew request stands so, and those without one for No request', () => {
    expect(names(filterFleet([...fleet, requested], view({ crewRequest: 'needsCrew' })))).toEqual(['scout']);
    expect(names(filterFleet([...fleet, requested], view({ crewRequest: 'none' })))).toEqual(['argo', 'builder-web', 'reviewer-01']);
  });
});

describe('the label filter (#102)', () => {
  const PROJECT = { labelId: idSchema('label').parse('lbl_01m3tbfspe96yf1rnr4ank9h0a'), key: 'project' };
  const HEMMA = { ...PROJECT, valueId: idSchema('labelValue').parse('lbv_01m3tbfspe96yf1rnr4ank9h1a'), value: 'hemma' };
  const AEOLUS = { ...PROJECT, valueId: idSchema('labelValue').parse('lbv_01m3tbfspe96yf1rnr4ank9h2a'), value: 'aeolus' };
  const BACKEND = { labelId: idSchema('label').parse('lbl_01m3tbfspe96yf1rnr4ank9h3a'), key: 'area', valueId: idSchema('labelValue').parse('lbv_01m3tbfspe96yf1rnr4ank9h4a'), value: 'backend' };
  const api = aShip({ name: 'hemma-api', labels: [HEMMA, BACKEND] });
  const web = aShip({ name: 'hemma-web', labels: [HEMMA] });
  const core = aShip({ name: 'aeolus-core', labels: [AEOLUS, BACKEND] });
  const labelled = [api, web, core];

  it('keeps the ships that carry every value picked: exact matches, all must hold', () => {
    expect(names(filterFleet(labelled, view({ labelValueIds: [HEMMA.valueId, BACKEND.valueId] })))).toEqual(['hemma-api']);
  });

  it('keeps every ship with no value picked', () => {
    expect(names(filterFleet(labelled, DEFAULT_FLEET_VIEW))).toEqual(['aeolus-core', 'hemma-api', 'hemma-web']);
  });

  it('keeps the values picked in the URL, in order, and leaves out what is no label value id', () => {
    const written = view({ labelValueIds: [HEMMA.valueId, BACKEND.valueId] });
    expect(readFleetView(fleetViewParams(written))).toEqual(written);
    expect(readFleetView(new URLSearchParams('label=hemma&label=' + AEOLUS.valueId)).filters.labelValueIds).toEqual([AEOLUS.valueId]);
  });

  it('counts each value picked as a filter in force', () => {
    expect(activeFilterCount({ ...DEFAULT_FLEET_VIEW.filters, type: 'reviewer', labelValueIds: [HEMMA.valueId, BACKEND.valueId] })).toBe(3);
  });
});

describe('the view in the URL', () => {
  it('leaves every default out', () => {
    expect(fleetViewParams(DEFAULT_FLEET_VIEW).toString()).toBe('');
  });

  it('reads back what it wrote', () => {
    const written = view({ query: 'rev', status: 'crewed', crewRequest: 'crashed', type: 'reviewer', squadron: 'team-a1b2c3', isRetiredShown: true });
    expect(readFleetView(fleetViewParams(written))).toEqual(written);
  });

  it('keeps every value of a repeated parameter from the page’s search params', () => {
    expect(urlParamsOf({ q: 'hemma', label: ['lbv_a', 'lbv_b'], crew: undefined }).toString()).toBe('q=hemma&label=lbv_a&label=lbv_b');
  });

  it('falls back to the default for a crew request stage it does not know', () => {
    expect(readFleetView(new URLSearchParams('crew=sailing')).filters.crewRequest).toBe('all');
  });

  it('falls back to the default for a status it does not know', () => {
    expect(readFleetView(new URLSearchParams('status=sailing')).filters.status).toBe('all');
  });
});

describe('activeFilterLabels', () => {
  it('names none for the default filters', () => {
    expect(activeFilterLabels(DEFAULT_FLEET_VIEW.filters)).toEqual([]);
  });

  it('names each filter in force, in the order of the controls', () => {
    expect(activeFilterLabels({ status: 'awaitingCrew', crewRequest: 'needsCrew', type: 'reviewer', squadron: 'hemma-feature-a1b2c3', isRetiredShown: true, labelValueIds: [] })).toEqual([
      'Status: Awaiting crew',
      'Crew request: Needs crew',
      'Type: reviewer',
      'Squadron: hemma-feature-a1b2c3',
      'Retired shown',
    ]);
  });
});
