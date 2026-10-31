/**
 * The range of usage the Usage page asks for (docs/design/usage/usage.md, U15
 * and "The read the console calls"): up to 7 days in whole hours, past that in
 * whole UTC days, because the trierarch plugin answers hours up to 7 days and
 * then days, and refuses a range that does not start and end on its grain.
 */

export const USAGE_RANGES = ['24h', '7d', '30d', '90d'] as const;
export type UsageRange = (typeof USAGE_RANGES)[number];

export type UsageGrain = 'hour' | 'day';

export interface UsageWindow {
  /** Inclusive, ISO 8601 in UTC, on a whole hour or a UTC midnight. */
  from: string;
  /** Exclusive. */
  to: string;
  grain: UsageGrain;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const HOURS_IN: Record<'24h' | '7d', number> = { '24h': 24, '7d': 7 * 24 };
const DAYS_IN: Record<'30d' | '90d', number> = { '30d': 30, '90d': 90 };

/**
 * The window a range names at `now`. Hours end at the hour that just ended,
 * as an hour shows once it ends (U13). Days end at the next UTC midnight, so
 * today so far is the last day.
 */
export function usageWindowOf(range: UsageRange, now: Date): UsageWindow {
  if (range === '24h' || range === '7d') {
    const to = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
    return { from: new Date(to - HOURS_IN[range] * HOUR_MS).toISOString(), to: new Date(to).toISOString(), grain: 'hour' };
  }
  const to = (Math.floor(now.getTime() / DAY_MS) + 1) * DAY_MS;
  return { from: new Date(to - DAYS_IN[range] * DAY_MS).toISOString(), to: new Date(to).toISOString(), grain: 'day' };
}
