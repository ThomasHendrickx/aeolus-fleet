import { describe, expect, it } from 'vitest';

import { createIdGenerator } from '../ids/index.js';
import { healthOutputSchema, STUCK_TREND_HOURS } from './health.js';

const newId = createIdGenerator();
const AT = '2026-10-16T09:00:00.000Z';

function perHour(hours: number) {
  return Array.from({ length: hours }, () => ({ at: AT, count: 0 }));
}

const health = {
  stuck: [
    {
      cause: 'stalledInFlight',
      place: { kind: 'ship', ship: { id: newId('ship'), name: 'builder-02' }, machine: { id: newId('ship'), name: 'hetzner-01', lastSeenAt: AT } },
      count: 2,
      oldestSince: AT,
    },
    { cause: 'noShipCanTake', place: { kind: 'type', type: 'mapper' }, count: 1, oldestSince: AT },
  ],
  stuckPerHour: perHour(STUCK_TREND_HOURS),
  acknowledged: { count: 246, medianMs: 6000 },
};

describe('healthOutputSchema', () => {
  it('takes the stuck places with their cause, count and oldest, the trend and the acknowledged', () => {
    expect(healthOutputSchema.parse(health)).toEqual(health);
  });

  it('counts 7 days of hours', () => {
    expect(STUCK_TREND_HOURS).toBe(168);
  });

  it('refuses a trend one hour short or one over', () => {
    expect(healthOutputSchema.safeParse({ ...health, stuckPerHour: perHour(STUCK_TREND_HOURS - 1) }).success).toBe(false);
    expect(healthOutputSchema.safeParse({ ...health, stuckPerHour: perHour(STUCK_TREND_HOURS + 1) }).success).toBe(false);
  });

  it('refuses a place with nothing stuck', () => {
    expect(healthOutputSchema.safeParse({ ...health, stuck: [{ ...health.stuck[1], count: 0 }] }).success).toBe(false);
  });

  it('refuses a cause it does not know, such as not handled', () => {
    expect(healthOutputSchema.safeParse({ ...health, stuck: [{ ...health.stuck[1], cause: 'notHandled' }] }).success).toBe(false);
  });

  it('takes no median when nothing was acknowledged', () => {
    expect(healthOutputSchema.parse({ ...health, acknowledged: { count: 0, medianMs: null } }).acknowledged).toEqual({ count: 0, medianMs: null });
  });
});
