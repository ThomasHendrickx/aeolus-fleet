import { describe, expect, it } from 'vitest';

import { usageNotesOf } from './usage-notes';

const BASE = { grain: 'hour', measure: 'tokens', splitBy: 'machine', hasOther: false } as const;

describe('the notes under the chart', () => {
  it('say hours are in the viewer time zone up to 7 days, and that an hour shows once it ends', () => {
    expect(usageNotesOf(BASE)).toContain('One column per hour, in your time zone. An hour shows once it ends.');
  });

  it('say days are in UTC past 7 days', () => {
    expect(usageNotesOf({ ...BASE, grain: 'day' })).toContain('One column per day, days in UTC.');
  });

  it('say once, on estimated cost, that on a subscription the dollars are list prices', () => {
    const notes = usageNotesOf({ ...BASE, measure: 'cost' });

    expect(notes.filter((note) => note.includes('list-price'))).toHaveLength(1);
    expect(usageNotesOf(BASE).some((note) => note.includes('list-price'))).toBe(false);
  });

  it('say on tokens that all four kinds add up', () => {
    expect(usageNotesOf(BASE)).toContain('Tokens add up input, output, cache read and cache write; split by token kind to see each.');
  });

  it('say what Not reported means when split by login', () => {
    expect(usageNotesOf({ ...BASE, splitBy: 'login' })).toContain('"Not reported": hours from before the trierarch reported a login.');
    expect(usageNotesOf(BASE).some((note) => note.includes('Not reported'))).toBe(false);
  });

  it('say that the 7 largest are shown and the rest are Other, when there is an Other', () => {
    expect(usageNotesOf({ ...BASE, hasOther: true })).toContain('The 7 largest in the range, the rest as Other.');
    expect(usageNotesOf(BASE).some((note) => note.includes('Other'))).toBe(false);
  });
});
