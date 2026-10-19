import { accountIdSchema, type AccountId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { createCutOffAccount } from './cut-off-account.js';
import type { AccountCutOff, AccountCutOffRepository } from './ports.js';

const MINUTE_MS = 60_000;
const burak = accountIdSchema.parse('acc-burak');

/** The cut-offs kept in memory, as the Postgres adapter keeps them in its table. */
function inMemoryCutOffs(): AccountCutOffRepository {
  const kept = new Map<AccountId, AccountCutOff>();
  return {
    record: (cutOff) => {
      const held = kept.get(cutOff.accountId);
      if (!held || held.cutOffAt < cutOff.cutOffAt) {
        kept.set(cutOff.accountId, cutOff);
      }
      return Promise.resolve();
    },
    cutOffAt: (accountId, at) => {
      const held = kept.get(accountId);
      return Promise.resolve(held && held.forgetAt > at ? held.cutOffAt : undefined);
    },
    forget: (at) => {
      for (const [accountId, held] of kept) {
        if (held.forgetAt <= at) {
          kept.delete(accountId);
        }
      }
      return Promise.resolve();
    },
  };
}

function cutOffAt(time: string) {
  const cutOffs = inMemoryCutOffs();
  let now = new Date(time);
  const cutOffAccount = createCutOffAccount({ cutOffs, clock: { now: () => now } });
  return {
    cutOffAccount,
    cutOffs,
    now: () => now,
    pass: (milliseconds: number) => {
      now = new Date(now.getTime() + milliseconds);
    },
  };
}

describe('cutting off an account', () => {
  it('refuses its tokens issued before now', async () => {
    const { cutOffAccount, cutOffs, now } = cutOffAt('2026-10-19T10:00:00Z');

    await cutOffAccount({ accountId: burak });

    expect(await cutOffs.cutOffAt(burak, now())).toEqual(new Date('2026-10-19T10:00:00Z'));
  });

  it('keeps the cut-off until the longest token issued before it has ended: 10 minutes and 30 seconds of life and 30 seconds of allowance', async () => {
    const { cutOffAccount, cutOffs, now, pass } = cutOffAt('2026-10-19T10:00:00Z');
    await cutOffAccount({ accountId: burak });

    pass(11 * MINUTE_MS - 1);

    expect(await cutOffs.cutOffAt(burak, now())).toEqual(new Date('2026-10-19T10:00:00Z'));
  });

  it('forgets the account once that token has ended', async () => {
    const { cutOffAccount, cutOffs, now, pass } = cutOffAt('2026-10-19T10:00:00Z');
    await cutOffAccount({ accountId: burak });

    pass(11 * MINUTE_MS);

    expect(await cutOffs.cutOffAt(burak, now())).toBeUndefined();
  });

  it('moves the cut-off on when the account is cut off again', async () => {
    const { cutOffAccount, cutOffs, now, pass } = cutOffAt('2026-10-19T10:00:00Z');
    await cutOffAccount({ accountId: burak });
    pass(5 * MINUTE_MS);

    await cutOffAccount({ accountId: burak });
    pass(10 * MINUTE_MS);

    expect(await cutOffs.cutOffAt(burak, now())).toEqual(new Date('2026-10-19T10:05:00Z'));
  });

  it('forgets every cut-off that has ended when it records one', async () => {
    const { cutOffAccount, cutOffs, pass } = cutOffAt('2026-10-19T10:00:00Z');
    await cutOffAccount({ accountId: burak });
    pass(11 * MINUTE_MS);
    await cutOffAccount({ accountId: accountIdSchema.parse('acc-priya') });

    // Asked as of long before, a kept cut-off would still answer: it is gone.
    expect(await cutOffs.cutOffAt(burak, new Date(0))).toBeUndefined();
  });
});
