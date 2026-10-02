import { describe, expect, it } from 'vitest';

import { EVENT_TYPES } from '../fleet/index.js';
import { REPORT_NOTE_MAX_LENGTH, REPORT_STATES, reportInputSchema, reportOutputSchema } from './report.js';

describe('REPORT_STATES', () => {
  it('are working, blocked and idle', () => {
    expect(REPORT_STATES).toEqual(['working', 'blocked', 'idle']);
  });
});

describe('reportInputSchema', () => {
  it.each([
    { state: 'working' },
    { state: 'blocked', note: 'waiting for review on PR 88' },
    { state: 'idle', note: 'x'.repeat(REPORT_NOTE_MAX_LENGTH) },
  ])('accepts %j: a state and an optional note', (input) => {
    expect(reportInputSchema.parse(input)).toEqual(input);
  });

  it('trims the note', () => {
    expect(reportInputSchema.parse({ state: 'working', note: '  on PR 89  ' })).toEqual({ state: 'working', note: 'on PR 89' });
  });

  it.each([
    ['an unknown state', { state: 'sleeping' }],
    ['no state', { note: 'on PR 89' }],
    ['a note over 200 characters', { state: 'working', note: 'x'.repeat(201) }],
    ['a note over one line', { state: 'working', note: 'on PR 89\nthen PR 90' }],
  ])('rejects %s', (_label, input) => {
    expect(reportInputSchema.safeParse(input).success).toBe(false);
  });
});

describe('reportOutputSchema', () => {
  it('answers nothing: the OK is the answer', () => {
    expect(reportOutputSchema.parse({})).toEqual({});
  });
});

describe('ShipReported', () => {
  it('is an event type', () => {
    expect(EVENT_TYPES).toContain('ShipReported');
  });
});
