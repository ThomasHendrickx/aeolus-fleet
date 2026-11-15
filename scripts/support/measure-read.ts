import type { Measurement } from './measurement.ts';

/** The nearest-rank percentile: the smallest sample that at least `percent` percent of the samples do not exceed. */
function percentile(samples: readonly number[], percent: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((percent / 100) * sorted.length));
  return sorted[rank - 1] ?? 0;
}

/** Calls a read `warmup` times, uncounted, then `samples` times, timing each with the clock; a failed call or one that throws is a sample and an error. */
export async function measureRead(run: { samples: number; warmup: number; clock: () => number; call: () => Promise<{ isOk: boolean }> }): Promise<Measurement> {
  for (let index = 0; index < run.warmup; index += 1) {
    await run.call().catch(() => undefined);
  }
  const calls: { ms: number; isOk: boolean }[] = [];
  for (let index = 0; index < run.samples; index += 1) {
    const start = run.clock();
    const isOk = await run.call().then(
      (answer) => answer.isOk,
      () => false,
    );
    calls.push({ ms: run.clock() - start, isOk });
  }
  const ms = calls.map((call) => call.ms);
  return {
    samples: calls.length,
    p95Ms: percentile(ms, 95),
    p99Ms: percentile(ms, 99),
    errorRate: calls.filter((call) => !call.isOk).length / calls.length,
  };
}
