import { idSchema } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { DEFAULT_FLEET_VIEW, type FleetFilters } from './fleet-filter';
import { fleetListFilterOf, fleetListSortOf } from './fleet-list-input';

function viewWith(filters: Partial<FleetFilters>, query = '') {
  return { query, filters: { ...DEFAULT_FLEET_VIEW.filters, ...filters } };
}

// One bar for both views (docs/design/fleet-overview): fleet.list and fleet.harbour read the same filter.
describe("the overview's bar as fleet.list and fleet.harbour select by it", () => {
  it('selects every active ship for the default view', () => {
    expect(fleetListFilterOf(DEFAULT_FLEET_VIEW)).toEqual({});
  });

  it('searches the names by the text typed, without the spaces around it', () => {
    expect(fleetListFilterOf(viewWith({}, '  scout '))).toEqual({ nameQuery: 'scout' });
  });

  it('passes the states, types and label values picked', () => {
    const valueId = idSchema('labelValue').parse('lbv_01m3tbfspe96yf1rnr4ank9h0a');

    expect(fleetListFilterOf(viewWith({ state: ['alert', 'waiting'], type: ['reviewer'], labelValueIds: [valueId] }))).toEqual({
      state: ['alert', 'waiting'],
      type: ['reviewer'],
      valueIds: [valueId],
    });
  });
});

describe("the overview's sort as fleet.list orders by it", () => {
  it('keeps the default order without a sort', () => {
    expect(fleetListSortOf(null)).toBeUndefined();
  });

  it('passes the column and direction', () => {
    expect(fleetListSortOf({ column: 'seen', direction: 'descending' })).toEqual({ column: 'seen', direction: 'descending' });
  });
});
