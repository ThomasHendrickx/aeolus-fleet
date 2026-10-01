import type { Clock } from '../../core/shared/clock.js';

export interface RateLimit {
  /** Attempts allowed per key in one window. */
  limit: number;
  windowMs: number;
}

export interface RateLimiter {
  /** Counts an attempt for the key. False when the key is over its limit in the current window. */
  take(key: string): boolean;
  /** True while the key has counted fewer than its limit in the current window. Counts nothing. */
  hasRoom(key: string): boolean;
  /** Counts one for the key, for a limit on some outcomes only, such as failures. */
  count(key: string): void;
  /** When the key's current window ends, so a key over its limit may try again; now when it has none. */
  retryAt(key: string): Date;
}

/**
 * A fixed-window counter per key, held in memory. v1 runs one server process
 * (docs/architecture.md, "Deployment"), so a shared store is not needed yet.
 */
export function createRateLimiter(limit: RateLimit, clock: Clock): RateLimiter {
  const windows = new Map<string, { startedAt: number; count: number }>();

  /** The key's count in the current window, after forgetting finished windows. */
  const countIn = (key: string, now: number): number => {
    const current = windows.get(key);
    if (!current || now - current.startedAt >= limit.windowMs) {
      forgetFinishedWindows(windows, { now, windowMs: limit.windowMs });
      return 0;
    }
    return current.count;
  };

  const count = (key: string): number => {
    const now = clock.now().getTime();
    const counted = countIn(key, now) + 1;
    const startedAt = counted === 1 ? now : (windows.get(key)?.startedAt ?? now);
    windows.set(key, { startedAt, count: counted });
    return counted;
  };

  return {
    take: (key) => count(key) <= limit.limit,
    hasRoom: (key) => countIn(key, clock.now().getTime()) < limit.limit,
    count: (key) => {
      count(key);
    },
    retryAt: (key) => {
      const now = clock.now().getTime();
      const current = countIn(key, now) === 0 ? undefined : windows.get(key);
      return new Date(current ? current.startedAt + limit.windowMs : now);
    },
  };
}

function forgetFinishedWindows(windows: Map<string, { startedAt: number }>, at: { now: number; windowMs: number }): void {
  const { now, windowMs } = at;
  for (const [key, window] of windows) {
    if (now - window.startedAt >= windowMs) {
      windows.delete(key);
    }
  }
}
