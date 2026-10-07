import { describe, expect, it } from 'vitest';

import { clockTime, dayDate, dayMonth, duration, fullDateTime, lastSeen, relativeTime, secondsTime, shortDateTime, sinceTime } from './relative-time';

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

describe('clockTime', () => {
  it('words a moment as a 24 h clock', () => {
    expect(clockTime(new Date(2026, 9, 1, 9, 5, 59))).toBe('09:05');
  });
});

describe('sinceTime', () => {
  it('is a clock within a day', () => {
    expect(sinceTime(new Date(2026, 8, 28, 10, 20), NOW)).toBe('10:20');
  });

  it('is day, month and clock once over a day ago', () => {
    expect(sinceTime(new Date(2026, 8, 26, 9, 5), NOW)).toBe('26 Sep, 09:05');
  });
});

describe('secondsTime', () => {
  it('words a moment as a 24 h clock to the second', () => {
    expect(secondsTime(new Date(2026, 9, 1, 9, 5, 7))).toBe('09:05:07');
  });
});

describe('dayDate', () => {
  it('words a date without a time', () => {
    expect(dayDate(new Date(2026, 8, 20, 16, 2))).toBe('20 Sep 2026');
  });
});

describe('duration', () => {
  const from = new Date(2026, 8, 28, 8, 0);
  const after = (ms: number) => new Date(from.getTime() + ms);

  it.each([
    [11 * 60_000, '11 min'],
    [6 * 3_600_000 + 30 * 60_000, '6 h 30 min'],
    [2 * 3_600_000, '2 h'],
    [26 * 3_600_000, '1 d 2 h'],
    [48 * 3_600_000, '2 d'],
    [0, '0 min'],
  ])('words %i ms as %s', (ms, words) => {
    expect(duration(from, after(ms))).toBe(words);
  });
});

describe('lastSeen', () => {
  const now = new Date('2026-10-01T14:00:00.000Z');

  it('counts seconds under a minute', () => {
    expect(lastSeen(new Date('2026-10-01T13:59:40.000Z'), now)).toBe('Last seen 20 s ago');
    expect(lastSeen(now, now)).toBe('Last seen 0 s ago');
  });

  it('reads as other relative times from a minute on', () => {
    expect(lastSeen(new Date('2026-10-01T13:54:00.000Z'), now)).toBe('Last seen 6 min ago');
  });
});

describe('dayMonth', () => {
  it('says the day and month', () => {
    expect(dayMonth(new Date(2026, 9, 1, 12))).toBe('1 Oct');
  });
});
