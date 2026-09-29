import type { Clock } from '../../core/shared/clock.js';

export interface RateLimit {
  /** Attempts allowed per key in one window. */
  limit: number;
  windowMs: number;
}

export interface RateLimiter {
  /** Counts an attempt for the key. False when the key is over its limit in the current window. */
  take(key: string): boolean;
}

/**
 * A fixed-window counter per key, held in memory. v1 runs one server process
 * (docs/architecture.md, "Deployment"), so a shared store is not needed yet.
 */
export function createRateLimiter(limit: RateLimit, clock: Clock): RateLimiter {
  const windows = new Map<string, { startedAt: number; count: number }>();

  return {
    take: (key) => {
      const now = clock.now().getTime();
      const current = windows.get(key);
      if (!current || now - current.startedAt >= limit.windowMs) {
        forgetFinishedWindows(windows, now, limit.windowMs);
        windows.set(key, { startedAt: now, count: 1 });
        return true;
      }
      current.count += 1;
      return current.count <= limit.limit;
    },
  };
}

function forgetFinishedWindows(
  windows: Map<string, { startedAt: number }>,
  now: number,
  windowMs: number,
): void {
  for (const [key, window] of windows) {
    if (now - window.startedAt >= windowMs) {
      windows.delete(key);
    }
  }
}
