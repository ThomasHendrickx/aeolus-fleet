import { describe, expect, it } from 'vitest';

import { renewUntilHolding } from './renew-until-holding';
import type { RenewalOutcome } from './renew-account-token';

const WANTED = ['trierarch:join'];

/** A console whose renewals answer in turn and whose session shows the scopes the last renewal brought. */
function console_(renewals: { outcome: RenewalOutcome; scopes: string[] }[]) {
  const waits: number[] = [];
  let renewed = 0;
  let scopes: string[] = ['fleet:read'];
  return {
    waits,
    renewals: () => renewed,
    run: () =>
      renewUntilHolding({
        wanted: WANTED,
        retryAfterMs: 61_000,
        renew: () => {
          const next = renewals[Math.min(renewed, renewals.length - 1)] ?? { outcome: 'unreachable' as const, scopes: [] };
          renewed += 1;
          scopes = next.scopes;
          return Promise.resolve(next.outcome);
        },
        scopesNow: () => Promise.resolve(scopes),
        wait: (ms) => {
          waits.push(ms);
          return Promise.resolve();
        },
      }),
  };
}

describe('renewing the account token after connecting the trierarch plugin (issue 1609)', () => {
  it('renews once and stops when the fresh token holds the plugin scope', async () => {
    const session = console_([{ outcome: 'renewed', scopes: ['fleet:read', 'trierarch:join'] }]);

    await expect(session.run()).resolves.toBe('holds');
    expect(session.renewals()).toBe(1);
    expect(session.waits).toEqual([]);
  });

  it("renews again once after pagasae's catalogue cache when the fresh token still lacks it", async () => {
    const session = console_([
      { outcome: 'renewed', scopes: ['fleet:read'] },
      { outcome: 'renewed', scopes: ['fleet:read', 'trierarch:join'] },
    ]);

    await expect(session.run()).resolves.toBe('holds');
    expect(session.renewals()).toBe(2);
    expect(session.waits).toEqual([61_000]);
  });

  it('renews no more than twice, however long the scope is missing', async () => {
    const session = console_([{ outcome: 'renewed', scopes: ['fleet:read'] }]);

    await expect(session.run()).resolves.toBe('lacks');
    expect(session.renewals()).toBe(2);
  });

  it('stops at the first renewal that did not bring a token', async () => {
    const session = console_([{ outcome: 'ended', scopes: [] }]);

    await expect(session.run()).resolves.toBe('ended');
    expect(session.renewals()).toBe(1);
    expect(session.waits).toEqual([]);
  });

  it('answers failed instead of rejecting when the session read fails', async () => {
    await expect(
      renewUntilHolding({
        wanted: WANTED,
        retryAfterMs: 61_000,
        renew: () => Promise.resolve('renewed'),
        scopesNow: () => Promise.reject(new Error('console.session unreachable')),
        wait: () => Promise.resolve(),
      }),
    ).resolves.toBe('failed');
  });
});
