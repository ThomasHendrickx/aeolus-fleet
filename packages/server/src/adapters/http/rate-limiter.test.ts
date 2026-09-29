import { describe, expect, it } from 'vitest';

import { createRateLimiter } from './rate-limiter.js';

function clockAt(start: number) {
  let now = start;
  return {
    now: () => new Date(now),
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('rate limiter', () => {
  it('allows the limit within one window, then refuses', () => {
    const clock = clockAt(0);
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000 }, clock);

    expect([1, 2, 3, 4].map(() => limiter.take('client'))).toEqual([true, true, true, false]);
  });

  it('allows again once the window has passed', () => {
    const clock = clockAt(0);
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 }, clock);
    limiter.take('client');
    clock.advance(59_999);
    expect(limiter.take('client')).toBe(false);

    clock.advance(1);

    expect(limiter.take('client')).toBe(true);
  });

  it('counts each key on its own', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 }, clockAt(0));

    expect(limiter.take('one')).toBe(true);
    expect(limiter.take('two')).toBe(true);
    expect(limiter.take('one')).toBe(false);
  });
});
