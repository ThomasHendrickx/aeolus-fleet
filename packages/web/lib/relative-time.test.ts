import { describe, expect, it } from 'vitest';

import { fullDateTime, relativeTime, shortDateTime } from './relative-time';

const NOW = new Date(2026, 8, 28, 14, 21, 5);

function before(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

describe('relativeTime', () => {
  it('says "Just now" under a minute', () => {
    expect(relativeTime(before(59_000), NOW)).toBe('Just now');
  });

  it('counts whole minutes under an hour', () => {
    expect(relativeTime(before(6 * 60_000 + 30_000), NOW)).toBe('6 min ago');
  });

  it('counts whole hours under a day', () => {
    expect(relativeTime(before(3 * 3_600_000 + 59 * 60_000), NOW)).toBe('3 h ago');
  });

  it('gives the date and time from a day on', () => {
    expect(relativeTime(before(24 * 3_600_000), NOW)).toBe('27 Sep, 14:21');
  });

  it('gives the date and time for a time after now, as a clock may drift', () => {
    expect(relativeTime(new Date(2026, 8, 28, 14, 30), NOW)).toBe('28 Sep, 14:30');
  });
});

describe('shortDateTime and fullDateTime', () => {
  it('pad the clock to two digits', () => {
    const at = new Date(2026, 0, 5, 7, 4, 9);
    expect(shortDateTime(at)).toBe('5 Jan, 07:04');
    expect(fullDateTime(at)).toBe('5 Jan 2026, 07:04:09');
  });
});
