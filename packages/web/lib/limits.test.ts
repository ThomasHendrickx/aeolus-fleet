import { describe, expect, it } from 'vitest';

import { composeRefusedNotice, messageLimitNotice, messageLimitReached, resetTime, shipLimitNotice, shipLimitReached } from './limits';

const RESETS = '2026-10-05T00:00:00.000Z';

describe('the limits the console shows', () => {
  it('finds the fleet at its ship limit only when a limit applies and its ships reach it', () => {
    expect(shipLimitReached({ ships: { limit: 10, count: 10 }, dailyMessages: { limit: null, count: 0, resetsAt: RESETS } })).toBe(10);
    expect(shipLimitReached({ ships: { limit: 10, count: 9 }, dailyMessages: { limit: null, count: 0, resetsAt: RESETS } })).toBeUndefined();
    expect(shipLimitReached({ ships: { limit: null, count: 99 }, dailyMessages: { limit: null, count: 0, resetsAt: RESETS } })).toBeUndefined();
    expect(shipLimitReached(undefined)).toBeUndefined();
  });

  it('finds the daily message limit reached only when a limit applies and today reaches it', () => {
    expect(messageLimitReached({ ships: { limit: null, count: 1 }, dailyMessages: { limit: 1000, count: 1000, resetsAt: RESETS } })).toEqual({ limit: 1000, resetsAt: RESETS });
    expect(messageLimitReached({ ships: { limit: null, count: 1 }, dailyMessages: { limit: 1000, count: 999, resetsAt: RESETS } })).toBeUndefined();
    expect(messageLimitReached({ ships: { limit: null, count: 1 }, dailyMessages: { limit: null, count: 5000, resetsAt: RESETS } })).toBeUndefined();
  });

  it('words when the count resets in UTC', () => {
    expect(resetTime(RESETS)).toBe('00:00 UTC');
  });

  it('words the three notices as designed', () => {
    expect(shipLimitNotice(10)).toEqual({
      title: 'Your fleet is at its ship limit',
      description: 'This fleet can have 10 ships, so it can’t take a new one. Limits are listed on your account.',
    });
    expect(messageLimitNotice({ limit: 1000, resetsAt: RESETS })).toEqual({
      title: 'Your fleet reached today’s message limit',
      description: 'It sent 1,000 messages today, its daily limit. New messages are refused until the limit resets at 00:00 UTC.',
    });
    expect(composeRefusedNotice({ limit: 1000, resetsAt: RESETS })).toEqual({
      title: 'This message wasn’t sent',
      description: 'Your fleet reached its limit of 1,000 messages today. Sending works again after the limit resets at 00:00 UTC.',
    });
  });
});
