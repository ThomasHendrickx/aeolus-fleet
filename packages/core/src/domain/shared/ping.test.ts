import { describe, expect, it } from 'vitest';

import type { Clock } from './clock.js';
import { createPing, type FleetCounter } from './ping.js';

const fixedClock = (iso: string): Clock => ({ now: () => new Date(iso) });

const inMemoryFleets = (count: number): FleetCounter => ({
  countFleets: () => Promise.resolve(count),
});

describe('ping', () => {
  it('returns the clock time and the fleet count', async () => {
    const ping = createPing({ clock: fixedClock('2026-09-29T12:00:00.000Z'), fleets: inMemoryFleets(3) });

    await expect(ping()).resolves.toEqual({
      serverTime: new Date('2026-09-29T12:00:00.000Z'),
      fleetCount: 3,
    });
  });

  it('reports zero fleets before the first fleet exists', async () => {
    const ping = createPing({ clock: fixedClock('2026-09-29T12:00:00.000Z'), fleets: inMemoryFleets(0) });

    await expect(ping()).resolves.toMatchObject({ fleetCount: 0 });
  });

  it('fails when the fleets cannot be counted', async () => {
    const unreachable: FleetCounter = {
      countFleets: () => Promise.reject(new Error('database unreachable')),
    };
    const ping = createPing({ clock: fixedClock('2026-09-29T12:00:00.000Z'), fleets: unreachable });

    await expect(ping()).rejects.toThrow('database unreachable');
  });
});
