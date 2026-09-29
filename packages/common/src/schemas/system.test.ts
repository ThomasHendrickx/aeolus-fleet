import { describe, expect, it } from 'vitest';

import { pingOutputSchema } from './system.js';

describe('pingOutputSchema', () => {
  it('accepts a UTC timestamp and a fleet count', () => {
    const output = { serverTime: '2026-09-29T12:00:00.000Z', fleetCount: 1 };

    expect(pingOutputSchema.parse(output)).toEqual(output);
  });

  it.each([
    ['a timestamp that is not ISO 8601', { serverTime: 'yesterday', fleetCount: 0 }],
    ['a negative fleet count', { serverTime: '2026-09-29T12:00:00.000Z', fleetCount: -1 }],
    ['a fractional fleet count', { serverTime: '2026-09-29T12:00:00.000Z', fleetCount: 0.5 }],
    ['a missing fleet count', { serverTime: '2026-09-29T12:00:00.000Z' }],
  ])('rejects %s', (_label, output) => {
    expect(pingOutputSchema.safeParse(output).success).toBe(false);
  });
});
