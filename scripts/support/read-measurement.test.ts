import { describe, expect, it } from 'vitest';

import { BUDGET, baselineOf, measureRead, percentile, reportOf, summarise, verdictOf, type ReadReport } from './read-measurement.ts';

describe('the percentile of a run', () => {
  it('is the nearest rank: the smallest value that at least p percent of the samples do not exceed', () => {
    const ms = Array.from({ length: 100 }, (_, index) => index + 1);
    expect(percentile(ms, 95)).toBe(95);
    expect(percentile(ms, 99)).toBe(99);
  });

  it('does not depend on the order the samples came in', () => {
    expect(percentile([300, 10, 200, 100], 50)).toBe(100);
  });

  it('is not defined for no samples', () => {
    expect(() => percentile([], 95)).toThrow('no samples');
  });
});

describe('summarising a read', () => {
  it('counts a failed call as a sample, slow or not, and as an error', () => {
    const summary = summarise([
      { ms: 10, isOk: true },
      { ms: 20, isOk: true },
      { ms: 900, isOk: false },
      { ms: 30, isOk: true },
    ]);
    expect(summary).toEqual({ samples: 4, p95Ms: 900, p99Ms: 900, errorRate: 0.25 });
  });
});

describe('the budget', () => {
  it('holds a read with p95 under 100 ms, p99 under 500 ms and errors under 1%', () => {
    expect(verdictOf({ samples: 200, p95Ms: 99, p99Ms: 499, errorRate: 0.0099 })).toEqual({ isWithin: true, over: [] });
  });

  it('names each limit a read reaches or passes', () => {
    expect(verdictOf({ samples: 200, p95Ms: 100, p99Ms: 600, errorRate: 0.01 })).toEqual({ isWithin: false, over: ['p95', 'p99', 'errors'] });
  });

  it('is the one the performance skill states', () => {
    expect(BUDGET).toEqual({ p95Ms: 100, p99Ms: 500, errorRate: 0.01 });
  });
});

describe('measuring a read', () => {
  const read = { name: 'fleet.health', procedure: 'fleet.health', credential: 'fleet' } as const;

  it('times each call by the clock it is given, after the warm-up calls that it does not count', async () => {
    let now = 0;
    const durations = [5_000, 5_000, 40, 60, 80];
    let call = 0;
    const measurement = await measureRead(read, {
      samples: 3,
      warmup: 2,
      clock: () => now,
      call: () => {
        now += durations[call++] ?? 0;
        return Promise.resolve({ isOk: true });
      },
    });
    expect(call).toBe(5);
    expect(measurement).toEqual({ samples: 3, p95Ms: 80, p99Ms: 80, errorRate: 0 });
  });

  it('counts a call that throws as an error and goes on', async () => {
    let calls = 0;
    const measurement = await measureRead(read, {
      samples: 4,
      warmup: 0,
      clock: () => 0,
      call: () => {
        calls += 1;
        return calls === 2 ? Promise.reject(new Error('socket hang up')) : Promise.resolve({ isOk: true });
      },
    });
    expect(measurement.errorRate).toBe(0.25);
    expect(measurement.samples).toBe(4);
  });
});

describe('the baseline', () => {
  it('reads the p95, p99 and error rate of each read by its name', () => {
    expect(baselineOf('{"fleet.health":{"p95Ms":2100,"p99Ms":3000,"errorRate":0}}')).toEqual({ 'fleet.health': { samples: 0, p95Ms: 2100, p99Ms: 3000, errorRate: 0 } });
  });

  it('refuses a baseline that is not that', () => {
    expect(() => baselineOf('{"fleet.health":{"p95Ms":"slow"}}')).toThrow();
  });
});

describe('the report', () => {
  const rows: ReadReport[] = [
    { name: 'fleet.health', measured: { samples: 200, p95Ms: 40, p99Ms: 90, errorRate: 0 } },
    { name: 'installation.fleets.get', measured: { samples: 200, p95Ms: 650, p99Ms: 900, errorRate: 0.02 } },
  ];

  it('puts each read against the budget with its verdict, as a table', () => {
    const report = reportOf(rows, {});
    expect(report).toContain('| fleet.health | 40 ms | 90 ms | 0% | within |');
    expect(report).toContain('| installation.fleets.get | 650 ms | 900 ms | 2% | over: p95, p99, errors |');
  });

  it('puts the baseline beside each number a read has one for, and not where it has none', () => {
    const report = reportOf(rows, { 'fleet.health': { samples: 0, p95Ms: 2100, p99Ms: 3000, errorRate: 0.1 } });
    expect(report).toContain('| fleet.health | 2100 ms to 40 ms | 3000 ms to 90 ms | 10% to 0% | within |');
    expect(report).toContain('| installation.fleets.get | 650 ms | 900 ms | 2% | over: p95, p99, errors |');
  });

  it('counts the reads over budget and never turns one into a failure', () => {
    expect(reportOf(rows, {})).toContain('1 of 2 reads are over the budget');
  });
});
