import { BUDGET } from './budget.ts';
import type { Baseline } from './baseline.ts';
import type { Measurement } from './measurement.ts';
import { verdictOf } from './verdict-of.ts';

/** A read of the run: what it measured, or why it could not be measured. */
export interface ReadReport {
  name: string;
  measured: Measurement | { notMeasured: string };
}

const percentOf = (rate: number): string => `${String(Math.round(rate * 1000) / 10)}%`;
const msOf = (ms: number): string => `${String(Math.round(ms))} ms`;

/**
 * The run as a Markdown table, each read against the budget and beside its S1 baseline. A read with no baseline entry says so
 * in its row and is named under the table; a read that could not be measured says why. It reports, it never refuses.
 */
export function reportOf(rows: readonly ReadReport[], baseline: Baseline): string {
  const lines = [
    `Budget: p95 under ${msOf(BUDGET.p95Ms)}, p99 under ${msOf(BUDGET.p99Ms)}, errors under ${percentOf(BUDGET.errorRate)}. A baseline reads "before to now".`,
    '',
    '| Read | p95 | p99 | Errors | Budget |',
    '|---|---|---|---|---|',
  ];
  const unmeasured: string[] = [];
  const withoutBaseline: string[] = [];
  let overCount = 0;
  let measuredCount = 0;
  for (const { name, measured } of rows) {
    if ('notMeasured' in measured) {
      lines.push(`| ${name} | not measured: ${measured.notMeasured} |`);
      unmeasured.push(name);
      continue;
    }
    measuredCount += 1;
    const before = baseline[name];
    if (before === undefined) {
      withoutBaseline.push(name);
    }
    const { isWithin, over } = verdictOf(measured);
    overCount += isWithin ? 0 : 1;
    const p95 = before === undefined ? `${msOf(measured.p95Ms)} (no baseline)` : `${msOf(before.p95Ms)} to ${msOf(measured.p95Ms)}`;
    const p99 = before === undefined ? msOf(measured.p99Ms) : `${msOf(before.p99Ms)} to ${msOf(measured.p99Ms)}`;
    const errors = before === undefined ? percentOf(measured.errorRate) : `${percentOf(before.errorRate)} to ${percentOf(measured.errorRate)}`;
    lines.push(`| ${name} | ${p95} | ${p99} | ${errors} | ${isWithin ? 'within' : `over: ${over.join(', ')}`} |`);
  }
  lines.push('', `${String(overCount)} of ${String(measuredCount)} reads are over the budget.`);
  if (withoutBaseline.length > 0) {
    lines.push(`No S1 baseline for: ${withoutBaseline.join(', ')}.`);
  }
  if (unmeasured.length > 0) {
    lines.push(`${String(unmeasured.length)} of ${String(rows.length)} reads are not measured: ${unmeasured.join(', ')}.`);
  }
  return lines.join('\n');
}
