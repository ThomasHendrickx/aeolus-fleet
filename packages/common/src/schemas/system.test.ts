import { describe, expect, it } from 'vitest';

import { pingOutputSchema, systemVersionOutputSchema } from './system.js';

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

describe('systemVersionOutputSchema', () => {
  it("accepts the server's and common's versions and the latest migration", () => {
    const output = { server: '0.24.0', common: '0.24.0', migration: '20261001040000_lease_last_seen' };

    expect(systemVersionOutputSchema.parse(output)).toEqual(output);
  });

  it('accepts no migration, before the first', () => {
    const output = { server: '0.24.0', common: '0.24.0', migration: null };

    expect(systemVersionOutputSchema.parse(output)).toEqual(output);
  });

  it.each([
    ['a missing migration', { server: '0.24.0', common: '0.24.0' }],
    ['a missing common version', { server: '0.24.0', migration: null }],
  ])('rejects %s', (_label, output) => {
    expect(systemVersionOutputSchema.safeParse(output).success).toBe(false);
  });
});
