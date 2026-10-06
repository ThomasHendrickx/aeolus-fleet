import { describe, expect, it } from 'vitest';

import { EVENT_TYPES } from '../fleet/index.js';
import {
  REPORT_DETAILS_MAX_BYTES,
  REPORT_NOTE_MAX_LENGTH,
  REPORT_STATES,
  reportDetailsBytes,
  reportDetailsSchema,
  reportInputSchema,
  reportLogOutputSchema,
  reportOutputSchema,
} from './report.js';

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

describe('REPORT_DETAILS_MAX_BYTES', () => {
  it('is 16 KB', () => {
    expect(REPORT_DETAILS_MAX_BYTES).toBe(16 * 1024);
  });
});

describe('reportDetailsBytes', () => {
  it('counts the UTF-8 bytes of the serialized JSON', () => {
    expect(reportDetailsBytes({ note: 'é' })).toBe('{"note":"é"}'.length + 1);
  });
});

describe('reportDetailsSchema', () => {
  it('accepts one JSON object, nested values included', () => {
    const details = { ships: { shp_1: { state: 'running', restarts: 2 } }, kept: ['a', 'b'], orphan: null, capped: true };

    expect(reportDetailsSchema.parse(details)).toEqual(details);
  });

  it.each([
    ['an array', ['a']],
    ['a string', 'running'],
    ['a number', 4],
    ['null', null],
  ])('rejects %s', (_label, details) => {
    expect(reportDetailsSchema.safeParse(details).success).toBe(false);
  });
});

describe('reportInputSchema with details', () => {
  it.each([
    ['details to set', { state: 'working', details: { running: 4 } }],
    ['details null to clear', { state: 'working', details: null }],
    ['a merge patch', { state: 'working', detailsPatch: { running: 5, crashed: null } }],
    ['a merge patch of null', { state: 'idle', detailsPatch: null }],
  ])('accepts %s', (_label, input) => {
    expect(reportInputSchema.parse(input)).toEqual(input);
  });

  it('rejects details and a merge patch together', () => {
    expect(reportInputSchema.safeParse({ state: 'working', details: {}, detailsPatch: {} }).success).toBe(false);
  });

  it('rejects details that are not an object', () => {
    expect(reportInputSchema.safeParse({ state: 'working', details: ['a'] }).success).toBe(false);
  });
});

describe('reportLogOutputSchema', () => {
  const report = {
    state: 'working',
    note: '4 of 6 running',
    reportedAt: '2026-10-06T09:00:00.000Z',
    detailsVersion: 3,
    details: { running: 4 },
  };

  it("holds the crew's own report and the previous crew's last report", () => {
    const log = { report, previousCrew: { ...report, state: 'idle', details: null, detailsVersion: 0 } };

    expect(reportLogOutputSchema.parse(log)).toEqual(log);
  });

  it('holds none of either before anyone reports', () => {
    expect(reportLogOutputSchema.parse({ report: null, previousCrew: null })).toEqual({ report: null, previousCrew: null });
  });

  it('rejects a negative details version', () => {
    expect(reportLogOutputSchema.safeParse({ report: { ...report, detailsVersion: -1 }, previousCrew: null }).success).toBe(false);
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
