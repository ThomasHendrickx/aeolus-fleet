import { describe, expect, it } from 'vitest';

import { REPORT_TONES, reportAge, reportedWhen, reportText } from './report';

const NOW = new Date('2026-10-03T07:10:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe('REPORT_TONES', () => {
  it('maps working to active, blocked to waiting and idle to ended', () => {
    expect(REPORT_TONES).toEqual({ working: 'active', blocked: 'waiting', idle: 'ended' });
  });
});

describe('reportAge', () => {
  it.each([
    [34_000, '34 s'],
    [2 * 60_000, '2 min'],
    [3 * 3_600_000, '3 h'],
  ])('says %i ms short as %s', (ms, age) => {
    expect(reportAge(ago(ms), NOW)).toBe(age);
  });
});

describe('reportedWhen', () => {
  it('says how long ago, for the ship page', () => {
    expect(reportedWhen(ago(2 * 60_000), NOW)).toBe('reported 2 min ago');
  });

  it('says just now under a minute', () => {
    expect(reportedWhen(ago(5_000), NOW)).toBe('reported just now');
  });
});

describe('reportText', () => {
  it('says the state and the note', () => {
    expect(reportText({ state: 'blocked', note: 'waiting for review', reportedAt: NOW.toISOString() })).toBe(
      'Blocked: waiting for review',
    );
  });

  it('says the state alone without a note', () => {
    expect(reportText({ state: 'idle', note: null, reportedAt: NOW.toISOString() })).toBe('Idle');
  });
});
