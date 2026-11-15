import { z } from 'zod';

/** The budget of every read at the target scale (the performance skill; performance design, decision 5). */
export const BUDGET = { p95Ms: 100, p99Ms: 500, errorRate: 0.01 } as const;

/** A read of the performance design: the tRPC procedure to call, and whose credential it takes. */
export interface Read {
  name: string;
  procedure: string;
  input?: unknown;
  /** `fleet`: the fleet credential of the run; `installation`: the installation token and the fleet it acts in. */
  credential: 'fleet' | 'installation';
}

export interface Measurement {
  samples: number;
  p95Ms: number;
  p99Ms: number;
  errorRate: number;
}

export interface ReadReport {
  name: string;
  measured: Measurement;
}

export type Baseline = Readonly<Record<string, Measurement>>;

/** The nearest-rank percentile: the smallest sample that at least `percent` percent of the samples do not exceed. */
export function percentile(samples: readonly number[], percent: number): number {
  if (samples.length === 0) {
    throw new Error('The percentile of no samples is not defined');
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((percent / 100) * sorted.length));
  return sorted[rank - 1] ?? 0;
}

/** A failed call is a sample too, slow or not, and an error. */
export function summarise(calls: readonly { ms: number; ok: boolean }[]): Measurement {
  const ms = calls.map((call) => call.ms);
  return {
    samples: calls.length,
    p95Ms: percentile(ms, 95),
    p99Ms: percentile(ms, 99),
    errorRate: calls.filter((call) => !call.ok).length / calls.length,
  };
}

/** Which limits of the budget a read reaches or passes: a read within it is under all three. */
export function verdictOf(measured: Measurement): { within: boolean; over: ('p95' | 'p99' | 'errors')[] } {
  const over: ('p95' | 'p99' | 'errors')[] = [];
  if (measured.p95Ms >= BUDGET.p95Ms) {
    over.push('p95');
  }
  if (measured.p99Ms >= BUDGET.p99Ms) {
    over.push('p99');
  }
  if (measured.errorRate >= BUDGET.errorRate) {
    over.push('errors');
  }
  return { within: over.length === 0, over };
}

/** Calls a read `warmup` times, uncounted, then `samples` times, timing each with the clock; a call that throws is an error. */
export async function measureRead(
  _read: Read,
  run: { samples: number; warmup: number; clock: () => number; call: () => Promise<{ ok: boolean }> },
): Promise<Measurement> {
  for (let index = 0; index < run.warmup; index += 1) {
    await run.call().catch(() => undefined);
  }
  const calls: { ms: number; ok: boolean }[] = [];
  for (let index = 0; index < run.samples; index += 1) {
    const start = run.clock();
    const ok = await run.call().then(
      (answer) => answer.ok,
      () => false,
    );
    calls.push({ ms: run.clock() - start, ok });
  }
  return summarise(calls);
}

const baselineSchema = z.record(z.string(), z.object({ p95Ms: z.number(), p99Ms: z.number(), errorRate: z.number() }));

/** S1's baseline as the run is given it: each read's p95, p99 and error rate by its name. */
export function baselineOf(json: string): Baseline {
  return Object.fromEntries(Object.entries(baselineSchema.parse(JSON.parse(json))).map(([name, numbers]) => [name, { samples: 0, ...numbers }]));
}

const percentOf = (rate: number): string => `${String(Math.round(rate * 1000) / 10)}%`;
const msOf = (ms: number): string => `${String(Math.round(ms))} ms`;

function beside(before: string | undefined, now: string): string {
  return before === undefined ? now : `${before} to ${now}`;
}

/** The run as a Markdown table, each read against the budget and beside its baseline; it reports, it never refuses. */
export function reportOf(rows: readonly ReadReport[], baseline: Baseline): string {
  const lines = [
    `Budget: p95 under ${msOf(BUDGET.p95Ms)}, p99 under ${msOf(BUDGET.p99Ms)}, errors under ${percentOf(BUDGET.errorRate)}. A baseline reads "before to now".`,
    '',
    '| Read | p95 | p99 | Errors | Budget |',
    '|---|---|---|---|---|',
  ];
  for (const { name, measured } of rows) {
    const before = baseline[name];
    const { within, over } = verdictOf(measured);
    lines.push(
      `| ${name} | ${beside(before && msOf(before.p95Ms), msOf(measured.p95Ms))} | ${beside(before && msOf(before.p99Ms), msOf(measured.p99Ms))} | ${beside(before && percentOf(before.errorRate), percentOf(measured.errorRate))} | ${within ? 'within' : `over: ${over.join(', ')}`} |`,
    );
  }
  const overCount = rows.filter((row) => !verdictOf(row.measured).within).length;
  lines.push('', `${String(overCount)} of ${String(rows.length)} reads are over the budget.`);
  return lines.join('\n');
}
