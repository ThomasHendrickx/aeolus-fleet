import { describe, expect, it } from 'vitest';

import { lastActivityWordsOf } from './harbour-activity.js';

// A tile says when its ship last did something, the same in the console and Bridge (docs/design/fleet-overview, "The tile"): now, 25 min, 3 h, yesterday, 2 d up to 6 days, then the date (28 Oct); No activity yet when it never did.
describe("a Harbour tile's last activity", () => {
  const NOW = new Date('2026-11-02T12:00:00.000Z');
  const agoOf = (minutes: number) => lastActivityWordsOf(new Date(NOW.getTime() - minutes * 60_000).toISOString(), NOW);

  it('says now within the first minute', () => {
    expect([agoOf(0), agoOf(0.9)]).toEqual(['now', 'now']);
  });

  it('counts whole minutes up to the hour', () => {
    expect([agoOf(1), agoOf(25), agoOf(59)]).toEqual(['1 min', '25 min', '59 min']);
  });

  it('counts whole hours up to a day', () => {
    expect([agoOf(60), agoOf(3 * 60 + 40), agoOf(23 * 60 + 59)]).toEqual(['1 h', '3 h', '23 h']);
  });

  it('says yesterday for the day after', () => {
    expect([agoOf(24 * 60), agoOf(47 * 60 + 59)]).toEqual(['yesterday', 'yesterday']);
  });

  it('counts whole days from two days up to six', () => {
    expect([agoOf(48 * 60), agoOf(6 * 24 * 60 + 23 * 60)]).toEqual(['2 d', '6 d']);
  });

  it('gives the date from a week on', () => {
    expect([agoOf(7 * 24 * 60), agoOf(5 * 7 * 24 * 60)]).toEqual(['26 Oct', '28 Sep']);
  });

  it('says now for a time a little ahead of the clock', () => {
    expect(agoOf(-2)).toBe('now');
  });

  it('says there is no activity while the ship did nothing yet', () => {
    expect(lastActivityWordsOf(null, NOW)).toBe('No activity yet');
  });
});
