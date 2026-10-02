import { describe, expect, it } from 'vitest';

import { reportLine } from './report';

const NOW = new Date('2026-10-02T19:10:00.000Z');

describe('reportLine', () => {
  it('says the state, the note and how long ago', () => {
    expect(reportLine({ state: 'blocked', note: 'waiting for review', reportedAt: '2026-10-02T19:07:00.000Z' }, NOW)).toBe(
      'Blocked · waiting for review · 3 min ago',
    );
  });

  it('leaves the note out when there is none', () => {
    expect(reportLine({ state: 'idle', note: null, reportedAt: NOW.toISOString() }, NOW)).toBe('Idle · just now');
  });
});
