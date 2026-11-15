import { describe, expect, it } from 'vitest';

import { createIdGenerator } from '../ids/index.js';
import { exchangeOutputSchema, exchangesEntrySchema } from './exchange.js';

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


describe('exchangesEntrySchema unseen plain messages', () => {
  it('requires a nonnegative integer unseenPlainMessages beside unacknowledged', () => {
    // Given an exchange summary with no unseen plain messages.
    const entry = {
      otherShipId: newId('ship'), otherShipName: 'lookout', otherShipType: 'agent', otherShipKind: 'agent', unacknowledged: 1,
      newestMessage: { messageId: newId('message'), senderShipId: newId('ship'), payload: '{}', isPayloadUnreadable: false, contentType: 'text/plain', sentAt: '2026-11-15T12:00:00.000Z' },
    };
    // When the required count is supplied, missing, negative or fractional.
    // Then only a nonnegative integer count is accepted.
    expect(exchangesEntrySchema.safeParse({ ...entry, unseenPlainMessages: 0 }).success).toBe(true);
    expect(exchangesEntrySchema.safeParse(entry).success).toBe(false);
    expect(exchangesEntrySchema.safeParse({ ...entry, unseenPlainMessages: -1 }).success).toBe(false);
    expect(exchangesEntrySchema.safeParse({ ...entry, unseenPlainMessages: 0.5 }).success).toBe(false);
  });
});
