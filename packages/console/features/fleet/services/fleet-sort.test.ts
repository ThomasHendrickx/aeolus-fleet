import { describe, expect, it } from 'vitest';

import { DEFAULT_FLEET_VIEW, fleetViewParams, type FleetView } from './fleet-filter';
import { nextSort } from './fleet-sort';
import { readFleetView } from './read-fleet-view';

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
