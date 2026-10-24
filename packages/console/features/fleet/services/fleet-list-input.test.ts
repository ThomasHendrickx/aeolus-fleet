import { idSchema } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { DEFAULT_FLEET_VIEW, type FleetFilters } from './fleet-filter';
import { fleetListFilterOf, fleetListSortOf } from './fleet-list-input';

const NO_PLUGINS: ReadonlySet<string> = new Set();
const known = { squadronsOf: undefined, pluginShipIds: NO_PLUGINS };

function viewWith(filters: Partial<FleetFilters>, query = '') {
  return { query, filters: { ...DEFAULT_FLEET_VIEW.filters, ...filters } };
}

describe("the overview's view as fleet.list selects it", () => {
  it('selects nothing more than the active ships for the default view', () => {
    expect(fleetListFilterOf(DEFAULT_FLEET_VIEW, known)).toEqual({});
  });

  it('searches by the text typed, without the spaces around it', () => {
    expect(fleetListFilterOf(viewWith({}, '  scout '), known)).toEqual({ query: 'scout' });
  });

  it('asks every status with Show retired and no status picked', () => {
    expect(fleetListFilterOf(viewWith({ isRetiredShown: true }), known)).toEqual({ status: ['awaitingCrew', 'crewed', 'retired'] });
  });

  it('asks only the statuses picked, Show retired or not', () => {
    expect(fleetListFilterOf(viewWith({ status: ['crewed'], isRetiredShown: true }), known)).toEqual({ status: ['crewed'] });
  });

  it('passes the types, crew requests and label values picked', () => {
    const valueId = idSchema('labelValue').parse('lbv_01m3tbfspe96yf1rnr4ank9h0a');

    expect(fleetListFilterOf(viewWith({ type: ['reviewer'], crewRequest: ['needsCrew'], labelValueIds: [valueId] }), known)).toEqual({
      type: ['reviewer'],
      crewRequest: ['needsCrew'],
      valueIds: [valueId],
    });
  });

  it("passes the kinds picked with the ships the console's plugins run as", () => {
    expect(fleetListFilterOf(viewWith({ kind: ['plugin'] }), { squadronsOf: undefined, pluginShipIds: new Set(['shp_plugin']) })).toEqual({
      kind: ['plugin'],
      pluginShipIds: ['shp_plugin'],
    });
  });

  it("selects a squadron's flagship and members by id", () => {
    const squadronsOf = new Map([
      ['shp_flagship', { squadronId: 'review', role: null }],
      ['shp_member', { squadronId: 'review', role: 'reviewer' }],
      ['shp_other', { squadronId: 'build', role: 'builder' }],
    ]);

    expect(fleetListFilterOf(viewWith({ squadron: ['review'] }), { squadronsOf, pluginShipIds: NO_PLUGINS })).toEqual({ shipIds: ['shp_flagship', 'shp_member'] });
  });

  it('selects no ship for a squadron picked while the squadrons are not known, or with no ship', () => {
    expect([
      fleetListFilterOf(viewWith({ squadron: ['review'] }), known),
      fleetListFilterOf(viewWith({ squadron: ['review'] }), { squadronsOf: new Map(), pluginShipIds: NO_PLUGINS }),
    ]).toEqual([null, null]);
  });
});

describe("the overview's sort as fleet.list orders by it", () => {
  it('keeps the default order with no sort', () => {
    expect(fleetListSortOf(null)).toBeUndefined();
  });

  it('sorts each column by itself', () => {
    expect(fleetListSortOf({ column: 'seen', direction: 'ascending' })).toEqual({ column: 'seen', direction: 'ascending' });
  });
});
