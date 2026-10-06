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

describe('rate limiter, counting only what its user counts', () => {
  it('has room until the limit is counted, and asking counts nothing', () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000 }, clockAt(0));

    expect([limiter.hasRoom('client'), limiter.hasRoom('client'), limiter.hasRoom('client')]).toEqual([true, true, true]);
    limiter.count('client');
    expect(limiter.hasRoom('client')).toBe(true);
    limiter.count('client');
    expect(limiter.hasRoom('client')).toBe(false);
  });

  it('has room again once the window has passed', () => {
    const clock = clockAt(0);
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 }, clock);
    limiter.count('client');
    clock.advance(59_999);
    expect(limiter.hasRoom('client')).toBe(false);

    clock.advance(1);

    expect(limiter.hasRoom('client')).toBe(true);
  });

  it('counts each key on its own', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 }, clockAt(0));

    limiter.count('one');

    expect([limiter.hasRoom('one'), limiter.hasRoom('two')]).toEqual([false, true]);
  });

  it('tells when a key over its limit may try again: when its window ends', () => {
    const clock = clockAt(0);
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 }, clock);
    limiter.take('client');
    clock.advance(20_000);
    limiter.take('client');

    expect(limiter.retryAt('client')).toEqual(new Date(60_000));
  });
});
