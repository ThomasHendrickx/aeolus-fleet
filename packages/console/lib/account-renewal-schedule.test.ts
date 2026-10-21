import { describe, expect, it } from 'vitest';

import { isTimeToRenew, renewalDelayOf, retryDelayOf, tokenEndOf } from './account-renewal-schedule';

const NOW = new Date('2026-10-21T10:00:00.000Z');

function tokenEndingIn(seconds: number): string {
  const payload = Buffer.from(JSON.stringify({ sub: 'acc-mathilde', exp: Math.floor(NOW.getTime() / 1000) + seconds })).toString('base64url');
  return `eyJhbGciOiJFUzI1NiJ9.${payload}.signature`;
}

describe("when the console renews an account's token (accounts design, A3)", () => {
  it('renews two minutes before the token ends', () => {
    expect(renewalDelayOf({ endsAt: new Date(NOW.getTime() + 600_000), now: NOW })).toBe(480_000);
  });

  it('renews at once when less than two minutes are left', () => {
    expect(renewalDelayOf({ endsAt: new Date(NOW.getTime() + 60_000), now: NOW })).toBe(0);
  });

  it('retries pagasae after 5 seconds, doubling up to a minute', () => {
    expect([0, 1, 2, 3, 4, 5].map(retryDelayOf)).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000]);
  });
});

describe('a page load past the renewal point (accounts design, A3)', () => {
  it("reads when the token cookie's token ends, without checking it: core checks it", () => {
    expect(tokenEndOf(tokenEndingIn(600))).toEqual(new Date(NOW.getTime() + 600_000));
  });

  it('reads no end from a cookie that is no token', () => {
    expect(tokenEndOf('not-a-token')).toBeUndefined();
  });

  it('is time to renew within two minutes of the end, not before', () => {
    expect([isTimeToRenew(tokenEndingIn(119), NOW), isTimeToRenew(tokenEndingIn(121), NOW), isTimeToRenew('not-a-token', NOW)]).toEqual([true, false, false]);
  });
});
