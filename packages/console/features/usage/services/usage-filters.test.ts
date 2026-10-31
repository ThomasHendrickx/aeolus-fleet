import { idSchema } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { DEFAULT_USAGE_STATE } from './usage-state';
import { filterItemsOf, filtersAfterPick, hasFilters, pickedKeysOf, requestFiltersOf } from './usage-filters';

const MAC = idSchema('ship').parse('shp_01j9k2t4qzr3a9w6m2v5n7ma01');
const { filters: NONE } = DEFAULT_USAGE_STATE;

describe('the filters of the Usage page', () => {
  it('offer the values the plugin lists, by name, a login not reported as such', () => {
    const items = filterItemsOf({
      values: [
        { value: MAC, name: 'trierarch-mac', tokens: 900 },
        { value: null, name: null, tokens: 10 },
        { value: 'shp_gone', name: null, tokens: 1 },
      ],
      nextCursor: null,
    });

    expect(items.map(({ word, tokens }) => ({ word, tokens }))).toEqual([
      { word: 'trierarch-mac', tokens: 900 },
      { word: 'Not reported', tokens: 10 },
      { word: 'shp_gone', tokens: 1 },
    ]);
  });

  it('pick values by key, a login not reported by its own key, and back', () => {
    const picked = filtersAfterPick(NONE, { breakdown: 'login', keys: [pickedKeysOf([null])[0] ?? '', 'API key ci'] });

    expect(picked.login).toEqual([null, 'API key ci']);
    expect(pickedKeysOf(picked.login)).toHaveLength(2);
  });

  it('pick ships by key as ship ids', () => {
    expect(filtersAfterPick(NONE, { breakdown: 'machine', keys: [MAC] }).machine).toEqual([MAC]);
  });

  it('ask the plugin to narrow only the breakdowns that have a value', () => {
    expect(requestFiltersOf(NONE)).toEqual({});
    expect(requestFiltersOf({ ...NONE, machine: [MAC], login: [null] })).toEqual({ machineShipIds: [MAC], logins: [null] });
  });

  it('are on when any breakdown has a value', () => {
    expect([hasFilters(NONE), hasFilters({ ...NONE, model: ['claude-opus-5-5'] })]).toEqual([false, true]);
  });
});
