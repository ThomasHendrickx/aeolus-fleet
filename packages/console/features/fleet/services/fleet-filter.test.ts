import { idSchema, type ListedShip } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import {
  activeFilterCount,
  activeFilterLabels,
  DEFAULT_FLEET_VIEW,
  fleetSquadrons,
  fleetViewParams,
  urlParamsOf,
  type FleetView,
} from './fleet-filter';
import { readFleetView } from './read-fleet-view';

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
    report: null, harness: null, model: null, activity: null, openAlertCount: 0, awaitingCrewSince: null, crewRequest: null, labels: [], retiredAt: null, ownerShipId: null,
    ...overrides,
  };
}

const argo = aShip({ name: 'argo', type: 'operator', kind: 'operator' });
const reviewer = aShip({ name: 'reviewer-01', type: 'reviewer' });
const builder = aShip({ name: 'builder-web', status: 'awaitingCrew', location: null });

function view(changes: Partial<FleetView['filters']> & { query?: string }): FleetView {
  const { query = '', ...filters } = changes;
  return { query, filters: { ...DEFAULT_FLEET_VIEW.filters, ...filters }, sort: null };
}

describe('the squadron filter', () => {
  const squadronsOf = new Map([
    [reviewer.id, { squadronId: 'team-a1b2c3', role: null }],
    [builder.id, { squadronId: 'team-a1b2c3', role: 'builder' }],
  ]);

  it('lists each squadron once, sorted', () => {
    expect(fleetSquadrons(new Map([...squadronsOf, [argo.id, { squadronId: 'docs-x7q2w9', role: 'writer' }]]))).toEqual(['docs-x7q2w9', 'team-a1b2c3']);
  });
});

describe('the label filter (#102)', () => {
  const PROJECT = { labelId: idSchema('label').parse('lbl_01m3tbfspe96yf1rnr4ank9h0a'), key: 'project' };
  const HEMMA = { ...PROJECT, valueId: idSchema('labelValue').parse('lbv_01m3tbfspe96yf1rnr4ank9h1a'), value: 'hemma' };
  const AEOLUS = { ...PROJECT, valueId: idSchema('labelValue').parse('lbv_01m3tbfspe96yf1rnr4ank9h2a'), value: 'aeolus' };
  const BACKEND = { labelId: idSchema('label').parse('lbl_01m3tbfspe96yf1rnr4ank9h3a'), key: 'area', valueId: idSchema('labelValue').parse('lbv_01m3tbfspe96yf1rnr4ank9h4a'), value: 'backend' };
  it('keeps the values picked in the URL, in order, and leaves out what is no label value id', () => {
    const written = view({ labelValueIds: [HEMMA.valueId, BACKEND.valueId] });
    expect(readFleetView(fleetViewParams(written))).toEqual(written);
    expect(readFleetView(new URLSearchParams('label=hemma&label=' + AEOLUS.valueId)).filters.labelValueIds).toEqual([AEOLUS.valueId]);
  });

  it('counts each value picked as a filter in force', () => {
    expect(activeFilterCount({ ...DEFAULT_FLEET_VIEW.filters, type: ['reviewer'], labelValueIds: [HEMMA.valueId, BACKEND.valueId] })).toBe(3);
  });
});

describe('the view in the URL', () => {
  it('leaves every default out', () => {
    expect(fleetViewParams(DEFAULT_FLEET_VIEW).toString()).toBe('');
  });

  it('reads back what it wrote', () => {
    const written = view({ query: 'rev', status: ['crewed'], crewRequest: ['crashed'], kind: ['claudeCode'], type: ['reviewer'], squadron: ['team-a1b2c3'], isRetiredShown: true });
    expect(readFleetView(fleetViewParams(written))).toEqual(written);
  });

  it('keeps every value of a repeated parameter from the page’s search params', () => {
    expect(urlParamsOf({ q: 'hemma', label: ['lbv_a', 'lbv_b'], crew: undefined }).toString()).toBe('q=hemma&label=lbv_a&label=lbv_b');
  });

  it('reads back several values picked in every filter, in the order picked', () => {
    const written = view({ status: ['awaitingCrew', 'crewed'], crewRequest: ['needsCrew', 'crashed'], kind: ['codex', 'claudeCode'], type: ['reviewer', 'builder'], squadron: ['team-a1b2c3', 'docs-x7q2w9'] });
    expect(readFleetView(fleetViewParams(written))).toEqual(written);
  });

  it('repeats a parameter once for each value picked', () => {
    expect(fleetViewParams(view({ kind: ['claudeCode', 'codex'] })).toString()).toBe('kind=claudeCode&kind=codex');
  });

  it('leaves out a crew request stage it does not know, keeping the rest', () => {
    expect(readFleetView(new URLSearchParams('crew=sailing&crew=needsCrew')).filters.crewRequest).toEqual(['needsCrew']);
  });

  it('leaves out a kind it does not know, keeping the rest', () => {
    expect(readFleetView(new URLSearchParams('kind=chat&kind=codex')).filters.kind).toEqual(['codex']);
  });

  it('leaves out a status it does not know, retired among them, keeping the rest', () => {
    expect(readFleetView(new URLSearchParams('status=sailing&status=retired&status=crewed')).filters.status).toEqual(['crewed']);
  });

  it('reads a value repeated in the URL once', () => {
    expect(readFleetView(new URLSearchParams('type=reviewer&type=reviewer')).filters.type).toEqual(['reviewer']);
  });
});

describe('activeFilterCount', () => {
  it('counts a filter with several values picked once', () => {
    expect(activeFilterCount({ ...DEFAULT_FLEET_VIEW.filters, kind: ['claudeCode', 'codex'], status: ['crewed'] })).toBe(2);
  });
});

describe('activeFilterLabels', () => {
  it('names every value picked in a filter, in the order picked', () => {
    expect(activeFilterLabels({ ...DEFAULT_FLEET_VIEW.filters, kind: ['codex', 'claudeCode'], status: ['crewed', 'awaitingCrew'] })).toEqual([
      'Status: Crewed, Awaiting crew',
      'Kind: Codex, Claude Code',
    ]);
  });

  it('names none for the default filters', () => {
    expect(activeFilterLabels(DEFAULT_FLEET_VIEW.filters)).toEqual([]);
  });

  it('names each filter in force, in the order of the controls', () => {
    expect(activeFilterLabels({ status: ['awaitingCrew'], crewRequest: ['needsCrew'], kind: ['codex'], type: ['reviewer'], squadron: ['hemma-feature-a1b2c3'], isRetiredShown: true, labelValueIds: [] })).toEqual([
      'Status: Awaiting crew',
      'Crew request: Needs crew',
      'Kind: Codex',
      'Type: reviewer',
      'Squadron: hemma-feature-a1b2c3',
      'Retired shown',
    ]);
  });
});
