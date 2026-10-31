import type { TokenUsage } from '../../../lib/trierarch-plugin-schemas';
import type { UsageMeasure } from './usage-state';
import type { UsageGrain, UsageWindow } from './usage-window';

/**
 * What the Usage page draws of `usage.tokens`: one column per hour or UTC day
 * of the range, the series stacked in it, and each series' colour. Pure: the
 * plugin adds up, ranks and filters; this lays the answer out.
 */

export const TOKEN_KINDS = ['input', 'output', 'cacheRead', 'cacheWrite'] as const;
export type TokenKind = (typeof TOKEN_KINDS)[number];
export type TokenCounts = Record<TokenKind, number>;

export const TOKEN_KIND_NAMES: Record<TokenKind, string> = { input: 'Input', output: 'Output', cacheRead: 'Cache read', cacheWrite: 'Cache write' };

/** The seven series colours of the design system, and the neutral one for Other. */
export const SERIES_COLOURS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7'] as const;
export type SeriesColour = (typeof SERIES_COLOURS)[number] | 'other';

type SeriesOfUsage = TokenUsage['series'][number];
type Amounts = SeriesOfUsage['amounts'];

export interface ChartSeries {
  /** What the series is, stable across ranges and splits: the colour and the stack follow it. */
  id: string;
  name: string;
  colour: SeriesColour;
  /** In the measure, over the range. */
  total: number;
}

export interface ChartColumn {
  /** ISO 8601 in UTC: the start of its hour or day. */
  at: string;
  /** The measure of each series that has usage in it, in the series' order. */
  segments: { seriesId: string; value: number }[];
  total: number;
  /** Each token kind added over the series, for the tooltip, whatever the measure. */
  kinds: TokenCounts;
}

export interface UsageChart {
  series: ChartSeries[];
  columns: ChartColumn[];
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const NO_KINDS: TokenCounts = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const NOT_REPORTED = 'Not reported';

function tokensOf(counts: TokenCounts): number {
  return counts.input + counts.output + counts.cacheRead + counts.cacheWrite;
}

function measureOf(amounts: Amounts, measure: UsageMeasure): number {
  return measure === 'tokens' ? tokensOf(amounts.tokens) : amounts.estimatedCostUsd;
}

function seriesIdOf(key: SeriesOfUsage['key']): string {
  switch (key.kind) {
    case 'value':
      return `value:${key.value ?? ''}`;
    case 'tokenKind':
      return `kind:${key.tokenKind}`;
    case 'other':
    case 'all':
      return key.kind;
  }
}

function seriesNameOf(series: SeriesOfUsage): string {
  const { key } = series;
  switch (key.kind) {
    case 'other':
      return 'Other';
    case 'all':
      return 'All usage';
    case 'tokenKind':
      return TOKEN_KIND_NAMES[key.tokenKind];
    case 'value':
      // A login not reported has no name; a ship the fleet does not know is shown by its id.
      return series.name ?? key.value ?? NOT_REPORTED;
  }
}

/** A fixed spread of an id over the colours (FNV-1a), so the same machine, ship or model keeps its colour across ranges. */
function slotOf(id: string): number {
  let hash = 0x811c9dc5;
  for (const character of id) {
    hash = Math.imul(hash ^ (character.codePointAt(0) ?? 0), 0x01000193) >>> 0;
  }
  return hash % SERIES_COLOURS.length;
}

/**
 * Each series' colour follows what it is, not its rank. A token kind has its
 * own fixed colour; Other is neutral; any other series takes the colour its id
 * spreads to, the next free one when another series on screen already has it.
 */
function coloursOf(series: readonly SeriesOfUsage[]): SeriesColour[] {
  const taken = new Set<number>();
  return series.map((one) => {
    if (one.key.kind === 'other') {
      return 'other';
    }
    if (one.key.kind === 'tokenKind') {
      return SERIES_COLOURS[TOKEN_KINDS.indexOf(one.key.tokenKind)] ?? 'other';
    }
    let slot = slotOf(seriesIdOf(one.key));
    for (let tried = 0; taken.has(slot) && tried < SERIES_COLOURS.length; tried += 1) {
      slot = (slot + 1) % SERIES_COLOURS.length;
    }
    taken.add(slot);
    return SERIES_COLOURS[slot] ?? 'other';
  });
}

function startsOf(window: UsageWindow): string[] {
  const step = window.grain === 'hour' ? HOUR_MS : DAY_MS;
  const starts: string[] = [];
  for (let at = Date.parse(window.from); at < Date.parse(window.to); at += step) {
    starts.push(new Date(at).toISOString());
  }
  return starts;
}

/** The chart of a range: every hour or day of it, the empty ones too. */
export function chartOf(input: { usage: TokenUsage; measure: UsageMeasure; window: UsageWindow }): UsageChart {
  const { usage, measure, window } = input;
  const colours = coloursOf(usage.series);
  const series = usage.series.map((one, index): ChartSeries => ({ id: seriesIdOf(one.key), name: seriesNameOf(one), colour: colours[index] ?? 'other', total: measureOf(one.amounts, measure) }));
  const bucketAt = new Map(usage.buckets.map((bucket) => [Date.parse(bucket.at), bucket]));
  const columns = startsOf(window).map((at): ChartColumn => {
    const bucket = bucketAt.get(Date.parse(at));
    const segments = (bucket?.amounts ?? []).flatMap((amounts) => {
      const one = series[amounts.series];
      return one === undefined ? [] : [{ seriesId: one.id, value: measureOf(amounts, measure) }];
    });
    const kinds = (bucket?.amounts ?? []).reduce<TokenCounts>(
      (sum, amounts) => ({ input: sum.input + amounts.tokens.input, output: sum.output + amounts.tokens.output, cacheRead: sum.cacheRead + amounts.tokens.cacheRead, cacheWrite: sum.cacheWrite + amounts.tokens.cacheWrite }),
      NO_KINDS,
    );
    return { at, segments, total: segments.reduce((sum, segment) => sum + segment.value, 0), kinds };
  });
  return { series, columns };
}

export interface UsageTotals {
  /** All four kinds. */
  tokens: number;
  estimatedCostUsd: number;
  /** The tokens of models the trierarch does not price: counted in tokens, nothing in the cost. */
  unpricedTokens: number;
  unpricedModels: string[];
}

export function totalsOf(usage: TokenUsage): UsageTotals {
  return { tokens: tokensOf(usage.totals.tokens), estimatedCostUsd: usage.totals.estimatedCostUsd, unpricedTokens: usage.totals.unpricedTokens, unpricedModels: [...usage.unpricedModels] };
}

export interface TimeFormat {
  grain: UsageGrain;
  /** The viewer's locale; the browser's own when unset. */
  locale?: string;
  /** The viewer's time zone for hours; the browser's own when unset. Days are always UTC. */
  timeZone?: string;
}

/** Formats a time in the locale, with the viewer's time zone for hours and UTC for days. */
function formatOf(at: string, options: { format: TimeFormat; fields: Intl.DateTimeFormatOptions }): string {
  const { format, fields } = options;
  const timeZone = format.grain === 'day' ? 'UTC' : format.timeZone;
  return new Intl.DateTimeFormat(format.locale, { ...fields, ...(timeZone === undefined ? {} : { timeZone }) }).format(new Date(at));
}

/** A column's full name, for the tooltip and the table: an hour in the viewer's time zone, a day in UTC. */
export function columnLabelOf(at: string, format: TimeFormat): string {
  return formatOf(at, { format, fields: format.grain === 'hour' ? { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' } : { weekday: 'short', day: 'numeric', month: 'short' } });
}

export interface AxisTick {
  /** The column the tick marks. */
  index: number;
  label: string;
}

const HOURS_BETWEEN_TICKS_IN_A_DAY = 6;
const HOURS_IN_A_DAY = 24;
const DAYS_BETWEEN_TICKS_UP_TO_30 = 7;
const DAYS_BETWEEN_TICKS_PAST_30 = 14;
const DAYS_IN_A_MONTH = 30;

/** Where the time axis is marked and with what: every sixth hour of a day, every day of a week, every week of a month, every second week past it. */
export function axisTicksOf(columns: readonly ChartColumn[], format: TimeFormat): AxisTick[] {
  const { grain } = format;
  const isDayOfHours = grain === 'hour' && columns.length <= HOURS_IN_A_DAY;
  const step = grain === 'hour' ? (isDayOfHours ? HOURS_BETWEEN_TICKS_IN_A_DAY : HOURS_IN_A_DAY) : columns.length > DAYS_IN_A_MONTH ? DAYS_BETWEEN_TICKS_PAST_30 : DAYS_BETWEEN_TICKS_UP_TO_30;
  return columns.flatMap((column, index) => {
    if (index % step !== 0) {
      return [];
    }
    const fields: Intl.DateTimeFormatOptions = grain === 'day' ? { day: 'numeric', month: 'short' } : isDayOfHours ? { hour: '2-digit', minute: '2-digit' } : { weekday: 'short', day: 'numeric' };
    const label = formatOf(column.at, { format, fields });
    return [{ index, label }];
  });
}
