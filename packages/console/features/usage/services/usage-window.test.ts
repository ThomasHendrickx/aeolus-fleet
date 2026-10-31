import { describe, expect, it } from 'vitest';

import { usageWindowOf } from './usage-window';

const NOW = new Date('2026-10-28T09:41:12Z');

describe('the range of usage the page asks for', () => {
  it('is the last 24 whole hours for 24 hours, ending at the hour that just ended', () => {
    expect(usageWindowOf('24h', NOW)).toEqual({ from: '2026-10-27T09:00:00.000Z', to: '2026-10-28T09:00:00.000Z', grain: 'hour' });
  });

  it('is the last 168 whole hours for 7 days, still in hours', () => {
    expect(usageWindowOf('7d', NOW)).toEqual({ from: '2026-10-21T09:00:00.000Z', to: '2026-10-28T09:00:00.000Z', grain: 'hour' });
  });

  it('is whole UTC days for 30 days, ending at the next UTC midnight so today is the last day', () => {
    expect(usageWindowOf('30d', NOW)).toEqual({ from: '2026-09-29T00:00:00.000Z', to: '2026-10-29T00:00:00.000Z', grain: 'day' });
  });

  it('is whole UTC days for 90 days', () => {
    expect(usageWindowOf('90d', NOW)).toEqual({ from: '2026-07-31T00:00:00.000Z', to: '2026-10-29T00:00:00.000Z', grain: 'day' });
  });
});
