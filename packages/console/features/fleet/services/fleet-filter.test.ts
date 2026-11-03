import { idSchema } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { activeFilterCount, activeFilterLabels, DEFAULT_FLEET_VIEW, fleetViewParams, isFiltered, urlParamsOf, type FleetView } from './fleet-filter';
import { readFleetView } from './read-fleet-view';

const HEMMA = idSchema('labelValue').parse('lbv_01m3tbfspe96yf1rnr4ank9h1a');
const BACKEND = idSchema('labelValue').parse('lbv_01m3tbfspe96yf1rnr4ank9h4a');

function view(changes: Partial<FleetView['filters']> & { query?: string; mode?: FleetView['mode'] }): FleetView {
  const { query = '', mode = 'cards', ...filters } = changes;
  return { mode, query, filters: { ...DEFAULT_FLEET_VIEW.filters, ...filters }, sort: null };
}

// The overview's address (docs/design/fleet-overview, "One view: cards or list"): `/` is cards with nothing filtered; view=list, state (repeated), type, label and q.
describe('the view in the address', () => {
  it('is cards with nothing filtered at /', () => {
    expect([fleetViewParams(DEFAULT_FLEET_VIEW).toString(), readFleetView(new URLSearchParams(''))]).toEqual(['', DEFAULT_FLEET_VIEW]);
  });

  it('writes the mockup’s address for cards with State Alert and Blocked, searched “er”', () => {
    expect(fleetViewParams(view({ state: ['alert', 'blocked'], query: 'er' })).toString()).toBe('q=er&state=alert&state=blocked');
  });

  it('keeps every filter when the view switches to the list', () => {
    const cards = view({ state: ['alert', 'blocked'], type: ['builder'], labelValueIds: [HEMMA], query: 'er' });

    const list = readFleetView(fleetViewParams({ ...cards, mode: 'list' }));

    expect(list).toEqual({ ...cards, mode: 'list' });
  });

  it('reads back several values picked in every filter, in the order picked', () => {
    const written = view({ state: ['working', 'alert'], type: ['reviewer', 'builder'], labelValueIds: [BACKEND, HEMMA], mode: 'list' });
    expect(readFleetView(fleetViewParams(written))).toEqual(written);
  });

  it('keeps the list’s sort', () => {
    const written: FleetView = { ...view({ mode: 'list' }), sort: { column: 'seen', direction: 'descending' } };
    expect(readFleetView(fleetViewParams(written))).toEqual(written);
  });

  it('leaves out a state, a view or a label it does not know, keeping the rest', () => {
    expect(readFleetView(new URLSearchParams('view=grid&state=sailing&state=idle&label=hemma&label=' + HEMMA))).toEqual(view({ state: ['idle'], labelValueIds: [HEMMA] }));
  });

  it('reads a value repeated in the address once', () => {
    expect(readFleetView(new URLSearchParams('type=reviewer&type=reviewer')).filters.type).toEqual(['reviewer']);
  });

  it('no longer reads the filters the bar left behind', () => {
    expect(readFleetView(new URLSearchParams('status=crewed&crew=needsCrew&kind=codex&squadron=a&retired=1'))).toEqual(DEFAULT_FLEET_VIEW);
  });

  it('keeps every value of a repeated parameter from the page’s search params', () => {
    expect(urlParamsOf({ q: 'hemma', label: ['lbv_a', 'lbv_b'], view: undefined }).toString()).toBe('q=hemma&label=lbv_a&label=lbv_b');
  });
});

describe('the filters in force', () => {
  it('counts a filter with several values once, and each label value picked', () => {
    expect(activeFilterCount(view({ state: ['alert', 'blocked'], type: ['builder'], labelValueIds: [HEMMA, BACKEND] }).filters)).toBe(4);
  });

  it('names each in words for the phone’s chips, in the order of the controls', () => {
    expect(activeFilterLabels(view({ type: ['builder'], state: ['alert', 'blocked'] }).filters)).toEqual(['State: Alert, Blocked', 'Type: builder']);
  });

  it('names none for the default filters', () => {
    expect(activeFilterLabels(DEFAULT_FLEET_VIEW.filters)).toEqual([]);
  });

  it('says whether the search or a filter narrows the view', () => {
    expect([isFiltered(DEFAULT_FLEET_VIEW), isFiltered(view({ query: ' ' })), isFiltered(view({ query: 'er' })), isFiltered(view({ state: ['idle'] }))]).toEqual([false, false, true, true]);
  });
});
