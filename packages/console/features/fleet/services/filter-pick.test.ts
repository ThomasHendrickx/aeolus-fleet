import { describe, expect, it } from 'vitest';

import { ALL, pickedAfter, pickedSummary, shownPicks } from './filter-pick';

const WORDS: Readonly<Record<string, string>> = { claudeCode: 'Claude Code', codex: 'Codex', trierarch: 'Trierarch' };

describe('shownPicks', () => {
  it('shows All checked while nothing is picked', () => {
    expect(shownPicks([])).toEqual([ALL]);
  });

  it('shows the values picked, without All', () => {
    expect(shownPicks(['codex', 'claudeCode'])).toEqual(['codex', 'claudeCode']);
  });
});

describe('pickedAfter', () => {
  it('adds a value picked to those picked before', () => {
    expect(pickedAfter(['codex'], ['codex', 'claudeCode'])).toEqual(['codex', 'claudeCode']);
  });

  it('drops All once a first value is picked', () => {
    expect(pickedAfter([], [ALL, 'codex'])).toEqual(['codex']);
  });

  it('takes out a value picked again', () => {
    expect(pickedAfter(['codex', 'claudeCode'], ['claudeCode'])).toEqual(['claudeCode']);
  });

  it('picks nothing when All is picked', () => {
    expect(pickedAfter(['codex', 'claudeCode'], ['codex', 'claudeCode', ALL])).toEqual([]);
  });

  it('picks nothing when the last value is taken out', () => {
    expect(pickedAfter(['codex'], [])).toEqual([]);
  });
});

describe('pickedSummary', () => {
  it('reads All while nothing is picked', () => {
    expect(pickedSummary([], WORDS)).toEqual({ kind: 'all' });
  });

  it('names the one value picked', () => {
    expect(pickedSummary(['codex'], WORDS)).toEqual({ kind: 'one', word: 'Codex' });
  });

  it('counts several values picked', () => {
    expect(pickedSummary(['codex', 'claudeCode', 'trierarch'], WORDS)).toEqual({ kind: 'several', count: 3 });
  });

  it('names a value with no word by itself', () => {
    expect(pickedSummary(['reviewer'], {})).toEqual({ kind: 'one', word: 'reviewer' });
  });
});
