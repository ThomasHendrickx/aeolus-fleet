import { describe, expect, it } from 'vitest';

import { medianOfWaits, waitsOf } from './wait-buckets.js';

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;

describe('the median of waits kept in buckets', () => {
  it('is none of no waits', () => {
    expect(medianOfWaits([])).toBeNull();
  });

  it('is the middle wait of an odd count, within half a percent', () => {
    const median = medianOfWaits([waitsOf([2 * SECOND_MS, 6 * SECOND_MS, 3 * MINUTE_MS])]);

    expect(median).toBeGreaterThan(5_970);
    expect(median).toBeLessThan(6_030);
  });

  it('is the mean of the two middle waits of an even count, within half a percent', () => {
    const median = medianOfWaits([waitsOf([4 * SECOND_MS, 8 * SECOND_MS])]);

    expect(median).toBeGreaterThan(5_970);
    expect(median).toBeLessThan(6_030);
  });

  it('rounds to the same whole second as the exact median just under a minute', () => {
    const median = medianOfWaits([waitsOf([59_400])]);

    expect(Math.round((median ?? 0) / SECOND_MS)).toBe(59);
  });

  it('sums the buckets of several hours', () => {
    const median = medianOfWaits([waitsOf([1 * SECOND_MS]), waitsOf([10 * SECOND_MS, 10 * SECOND_MS])]);

    expect(median).toBeGreaterThan(9_950);
    expect(median).toBeLessThan(10_050);
  });

  it('counts a wait of no time as no time', () => {
    expect(medianOfWaits([waitsOf([0])])).toBe(0);
  });
});
