import { idSchema, type ShipId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { DEFAULT_USAGE_STATE, usageSearchOf, usageStateOf } from './usage-state';

/** The server's check of a ship id, handed to the state: the browser never parses ids. */
const asShipId = (value: string): ShipId | undefined => idSchema('ship').safeParse(value).data;
const shipId = (suffix: string): ShipId => idSchema('ship').parse(`shp_01j9k2t4qzr3a9w6m2v5n7${suffix}`);
const [MAC, A, B] = [shipId('ma01'), shipId('sa01'), shipId('sb01')];

describe('the Usage page reads its state from the URL', () => {
  it('opens on 7 days, split by machine, in tokens, unfiltered, without the table', () => {
    expect(usageStateOf({}, asShipId)).toEqual(DEFAULT_USAGE_STATE);
    expect(DEFAULT_USAGE_STATE).toEqual({ range: '7d', splitBy: 'machine', measure: 'tokens', filters: { machine: [], harness: [], model: [], ship: [], login: [] }, isTable: false });
  });

  it('reads the range, the split, the measure and the table', () => {
    const state = usageStateOf({ range: '90d', split: 'kind', measure: 'cost', view: 'table' }, asShipId);

    expect(state).toMatchObject({ range: '90d', splitBy: 'kind', measure: 'cost', isTable: true });
  });

  it('reads a filter per breakdown, a link from a machine card opening it filtered', () => {
    const state = usageStateOf({ machine: MAC, ship: [A, B], harness: 'claude-code', model: 'claude-opus-5-5' }, asShipId);

    expect(state.filters).toEqual({ machine: [MAC], harness: ['claude-code'], model: ['claude-opus-5-5'], ship: [A, B], login: [] });
  });

  it('reads a login not reported as an empty login', () => {
    const state = usageStateOf({ login: ['', 'API key ci'] }, asShipId);

    expect(state.filters.login).toEqual([null, 'API key ci']);
  });

  it('drops what it does not know: an unknown range, split or measure, and a ship id that is none', () => {
    const state = usageStateOf({ range: '1y', split: 'colour', measure: 'money', machine: 'not-an-id' }, asShipId);

    expect(state).toEqual(DEFAULT_USAGE_STATE);
  });
});

describe('the Usage page writes its state to the URL', () => {
  it('writes nothing for the page as it opens', () => {
    expect(usageSearchOf(DEFAULT_USAGE_STATE)).toBe('');
  });

  it('writes only what differs from how the page opens', () => {
    const state = { ...DEFAULT_USAGE_STATE, range: '30d' as const, measure: 'cost' as const, isTable: true };

    expect(usageSearchOf(state)).toBe('?range=30d&measure=cost&view=table');
  });

  it('writes each filter value on its own, a login not reported as empty', () => {
    const state = { ...DEFAULT_USAGE_STATE, filters: { ...DEFAULT_USAGE_STATE.filters, ship: [A, B], login: [null] } };

    expect(usageSearchOf(state)).toBe(`?ship=${A}&ship=${B}&login=`);
  });

  it('reads back what it wrote', () => {
    const state = { range: '24h' as const, splitBy: 'login' as const, measure: 'cost' as const, isTable: true, filters: { machine: [MAC], harness: ['codex'], model: [], ship: [], login: [null, 'x'] } };
    const params = new URLSearchParams(usageSearchOf(state));

    expect(usageStateOf({ ...Object.fromEntries([...params.keys()].map((key) => [key, params.getAll(key)])) }, asShipId)).toEqual(state);
  });
});
