import { describe, expect, it } from 'vitest';

import { createIdGenerator } from '../ids/index.js';
import { ACKNOWLEDGED_HOURS, healthOutputSchema, STUCK_TREND_HOURS } from './health.js';

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
      deliveries: [
        { deliveryId: newId('delivery'), state: 'received', since: AT },
        { deliveryId: newId('delivery'), state: 'pending', since: AT },
      ],
    },
    { cause: 'noShipCanTake', place: { kind: 'type', type: 'mapper' }, count: 1, oldestSince: AT, deliveries: [{ deliveryId: newId('delivery'), state: 'pending', since: AT }] },
  ],
  stuckPerHour: perHour(STUCK_TREND_HOURS),
  acknowledged: { count: 246, medianMs: 6000, perHour: perHour(ACKNOWLEDGED_HOURS) },
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
    const none = { count: 0, medianMs: null, perHour: perHour(ACKNOWLEDGED_HOURS) };

    expect(healthOutputSchema.parse({ ...health, acknowledged: none }).acknowledged).toEqual(none);
  });

  it('counts the acknowledged over 24 hours, one hour short refused', () => {
    expect(ACKNOWLEDGED_HOURS).toBe(24);
    expect(healthOutputSchema.safeParse({ ...health, acknowledged: { ...health.acknowledged, perHour: perHour(ACKNOWLEDGED_HOURS - 1) } }).success).toBe(false);
  });

  it('refuses a stuck delivery in a state that is never stuck, such as acknowledged', () => {
    const [place] = health.stuck;

    expect(healthOutputSchema.safeParse({ ...health, stuck: [{ ...place, deliveries: [{ deliveryId: newId('delivery'), state: 'acknowledged', since: AT }] }] }).success).toBe(false);
  });
});
