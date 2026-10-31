import type { TokenUsage, UsageValuesPage } from '../../../lib/trierarch-plugin-schemas';
import { chartOf, totalsOf } from './usage-chart';
import { usageWindowOf, type UsageRange } from './usage-window';
import type { UsageMeasure } from './usage-state';

/** Example usage for the Usage stories: three machines' tokens over the range, worked out from the hour so the same range always draws the same columns. */

export const USAGE_NOW = new Date('2026-10-28T09:41:12Z');

type Series = TokenUsage['series'][number];
type Amounts = Series['amounts'];

const FAMILIES = [
  { value: 'shp_01j9k2t4qzr3a9w6m2v5n7ma01', name: 'trierarch-mac', weight: 1.5 },
  { value: 'shp_01j9k2t4qzr3a9w6m2v5n7li01', name: 'trierarch-linux-1', weight: 1 },
  { value: 'shp_01j9k2t4qzr3a9w6m2v5n7ma02', name: 'trierarch-macbook', weight: 0.4 },
];

const HOUR_MS = 3_600_000;
const COST_PER_TOKEN = 0.000004;
const WORKING_HOURS_FROM = 8;
const WORKING_HOURS_TO = 19;

function amountsOf(weight: number, at: number): Amounts {
  const hour = new Date(at).getUTCHours();
  const busy = hour >= WORKING_HOURS_FROM && hour <= WORKING_HOURS_TO ? 1 : 0.2;
  const scale = weight * busy * (0.6 + ((at / HOUR_MS) % 7) / 10);
  const tokens = { input: Math.round(18_000 * scale), output: Math.round(60_000 * scale), cacheRead: Math.round(2_600_000 * scale), cacheWrite: Math.round(190_000 * scale) };
  return { tokens, estimatedCostUsd: (tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite) * COST_PER_TOKEN, unpricedTokens: 0 };
}

function sumOf(parts: readonly Amounts[]): Amounts {
  return parts.reduce<Amounts>(
    (sum, part) => ({
      tokens: { input: sum.tokens.input + part.tokens.input, output: sum.tokens.output + part.tokens.output, cacheRead: sum.tokens.cacheRead + part.tokens.cacheRead, cacheWrite: sum.tokens.cacheWrite + part.tokens.cacheWrite },
      estimatedCostUsd: sum.estimatedCostUsd + part.estimatedCostUsd,
      unpricedTokens: sum.unpricedTokens + part.unpricedTokens,
    }),
    { tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, estimatedCostUsd: 0, unpricedTokens: 0 },
  );
}

/** Usage split by machine over a range, the hours before the last two empty. */
export function machineUsageOf(range: UsageRange): TokenUsage {
  const window = usageWindowOf(range, USAGE_NOW);
  const step = window.grain === 'hour' ? HOUR_MS : 24 * HOUR_MS;
  const times: number[] = [];
  for (let at = Date.parse(window.from); at < Date.parse(window.to); at += step) {
    times.push(at);
  }
  const perDay = window.grain === 'hour' ? 1 : 24;
  const perBucket = (weight: number, at: number) => sumOf(Array.from({ length: perDay }, (_, hour) => amountsOf(weight, at + hour * HOUR_MS)));
  const buckets = times.map((at) => ({ at: new Date(at).toISOString(), amounts: FAMILIES.map((family, series) => ({ series, ...perBucket(family.weight, at) })) }));
  const series = FAMILIES.map((family, index): Series => ({ key: { kind: 'value', value: family.value }, name: family.name, amounts: sumOf(buckets.flatMap((bucket) => bucket.amounts[index] ?? [])) }));
  return { grain: window.grain, series, buckets, totals: sumOf(series.map((one) => one.amounts)), unpricedModels: [] };
}

/** The same with a model the trierarch does not price. */
export function usageWithUnpricedOf(range: UsageRange): TokenUsage {
  const usage = machineUsageOf(range);
  return { ...usage, totals: { ...usage.totals, unpricedTokens: 1_800_000 }, unpricedModels: ['gpt-6-sol'] };
}

export function chartFixtureOf(range: UsageRange, measure: UsageMeasure = 'tokens') {
  const usage = machineUsageOf(range);
  return { chart: chartOf({ usage, measure, window: usageWindowOf(range, USAGE_NOW) }), totals: totalsOf(usage) };
}

/** The first page of machines in the range, as `usage.values` answers it. */
export const MACHINE_VALUES: UsageValuesPage = {
  values: FAMILIES.map((family, index) => ({ value: family.value, name: family.name, tokens: 4_000_000 / (index + 1) })),
  nextCursor: null,
};
