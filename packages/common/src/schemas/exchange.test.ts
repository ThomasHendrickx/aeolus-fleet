import { describe, expect, it } from 'vitest';

import { createIdGenerator } from '../ids/index.js';
import { exchangeOutputSchema } from './exchange.js';

// Where an exchange's history ends (docs/design/exchange-history, section 5):
// every page of `exchange` answers how far pruning went, or null.

const newId = createIdGenerator();

const aPage = { items: [], olderCursor: null, newerCursor: newId('delivery') };

describe('exchangeOutputSchema', () => {
  it('answers prunedUpTo as an ISO time in UTC, or null when pruning removed none of the exchange', () => {
    expect(exchangeOutputSchema.parse({ ...aPage, prunedUpTo: '2026-10-08T12:00:00.000Z' })).toMatchObject({ prunedUpTo: '2026-10-08T12:00:00.000Z' });
    expect(exchangeOutputSchema.parse({ ...aPage, prunedUpTo: null })).toMatchObject({ prunedUpTo: null });
  });

  it('requires prunedUpTo on every page', () => {
    expect(exchangeOutputSchema.safeParse(aPage).success).toBe(false);
  });

  it('rejects a prunedUpTo that is not an ISO time', () => {
    expect(exchangeOutputSchema.safeParse({ ...aPage, prunedUpTo: '8 October' }).success).toBe(false);
  });
});
