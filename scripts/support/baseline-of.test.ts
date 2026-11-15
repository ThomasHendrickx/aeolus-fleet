import { describe, expect, it } from 'vitest';

import { baselineOf } from './baseline-of.ts';

describe("S1's baseline", () => {
  it('gives each read its p95, p99 and error rate by its name', () => {
    expect(baselineOf('{"fleet.health":{"p95Ms":2100,"p99Ms":3000,"errorRate":0}}')).toEqual({ 'fleet.health': { p95Ms: 2100, p99Ms: 3000, errorRate: 0 } });
  });

  it('is refused when an entry has no numbers, rather than read as a baseline of nothing', () => {
    expect(() => baselineOf('{"fleet.health":{"p95Ms":"slow"}}')).toThrow();
  });

  it('is refused when it holds no read at all', () => {
    expect(() => baselineOf('{}')).toThrow('no read');
  });
});
