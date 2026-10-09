import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SQUADRON_VIEW,
  disbandedCount,
  filterSquadrons,
  readSquadronView,
  squadronBlueprints,
  squadronViewParams,
  type SquadronView,
} from './squadron-filter';
import type { SquadronState } from './squadron-states';

function aSquadron(id: string, formed: { state: SquadronState; blueprint: string }) {
  return { id, state: formed.state, blueprint: { repository: 'example.com/templates', name: formed.blueprint, version: 1, commit: 'c' } };
}

const squadrons = [
  aSquadron('aeolus-a1b2c3', { state: 'sailing', blueprint: 'aeolus' }),
  aSquadron('docs-x7q2w9', { state: 'forming', blueprint: 'docs' }),
  aSquadron('aeolus-z8y7x6', { state: 'disbanded', blueprint: 'aeolus' }),
];

function ids(view: Partial<SquadronView>): string[] {
  return filterSquadrons(squadrons, { ...DEFAULT_SQUADRON_VIEW, ...view }).map((squadron) => squadron.id);
}

describe('filtering the squadrons', () => {
  it('hides disbanded squadrons until shown', () => {
    expect(ids({})).toEqual(['aeolus-a1b2c3', 'docs-x7q2w9']);
    expect(ids({ isDisbandedShown: true })).toContain('aeolus-z8y7x6');
  });

  it('searches the squadron id and the blueprint, ignoring case', () => {
    expect(ids({ query: 'X7Q' })).toEqual(['docs-x7q2w9']);
    expect(ids({ query: 'aeolus' })).toEqual(['aeolus-a1b2c3']);
  });

  it('filters by state and by blueprint', () => {
    expect(ids({ state: 'forming' })).toEqual(['docs-x7q2w9']);
    expect(ids({ blueprint: 'aeolus', isDisbandedShown: true })).toEqual(['aeolus-a1b2c3', 'aeolus-z8y7x6']);
  });

  it('lists each blueprint once, sorted, and counts the disbanded', () => {
    expect(squadronBlueprints(squadrons)).toEqual(['aeolus', 'docs']);
    expect(disbandedCount(squadrons)).toBe(1);
  });
});

describe('the squadrons view in the URL', () => {
  it('leaves every default out and reads back what it wrote', () => {
    const written: SquadronView = { query: 'aeo', state: 'sailing', blueprint: 'aeolus', isDisbandedShown: true };

    expect(squadronViewParams(DEFAULT_SQUADRON_VIEW).toString()).toBe('');
    expect(readSquadronView(squadronViewParams(written))).toEqual(written);
  });

  it.each(['disbanded', 'sunk'])('falls back to all for the state %s', (state) => {
    expect(readSquadronView(new URLSearchParams({ state })).state).toBe('all');
  });
});
