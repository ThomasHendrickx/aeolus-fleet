import { describe, expect, it } from 'vitest';

import type { TokenUsage } from '../../../lib/trierarch-plugin-schemas';
import { axisTicksOf, chartOf, columnLabelOf, totalsOf } from './usage-chart';
import { usageWindowOf } from './usage-window';

type Series = TokenUsage['series'][number];
type Amounts = Series['amounts'];

const NOW = new Date('2026-10-28T09:41:12Z');
const NONE: Amounts = { tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, estimatedCostUsd: 0, unpricedTokens: 0 };
const amounts = (tokens: Partial<Amounts['tokens']>, estimatedCostUsd = 0): Amounts => ({ ...NONE, tokens: { ...NONE.tokens, ...tokens }, estimatedCostUsd });
const machine = (value: string, name: string): Series => ({ key: { kind: 'value', value }, name, amounts: NONE });
const OTHER: Series = { key: { kind: 'other' }, name: null, amounts: NONE };

function usageOf(parts: Partial<TokenUsage>): TokenUsage {
  return { grain: 'hour', series: [], buckets: [], totals: NONE, unpricedModels: [], ...parts };
}

const MAC = machine('shp_mac', 'trierarch-mac');
const LINUX = machine('shp_linux', 'trierarch-linux-1');

describe('the chart of usage', () => {
  it('has one column per hour of the range, the hours without usage empty', () => {
    const chart = chartOf({
      usage: usageOf({ series: [MAC], buckets: [{ at: '2026-10-28T08:00:00.000Z', amounts: [{ series: 0, ...amounts({ input: 10 }) }] }] }),
      measure: 'tokens',
      window: usageWindowOf('24h', NOW),
    });

    expect(chart.columns).toHaveLength(24);
    expect(chart.columns.filter((column) => column.total > 0).map((column) => column.at)).toEqual(['2026-10-28T08:00:00.000Z']);
    expect(chart.columns.at(-1)).toMatchObject({ at: '2026-10-28T08:00:00.000Z', total: 10 });
  });

  it('has one column per UTC day past 7 days', () => {
    const chart = chartOf({ usage: usageOf({ grain: 'day' }), measure: 'tokens', window: usageWindowOf('30d', NOW) });

    expect(chart.columns).toHaveLength(30);
    expect(chart.columns[0]?.at).toBe('2026-09-29T00:00:00.000Z');
  });

  it('adds up all four token kinds as tokens', () => {
    const chart = chartOf({
      usage: usageOf({ series: [MAC], buckets: [{ at: '2026-10-28T08:00:00.000Z', amounts: [{ series: 0, ...amounts({ input: 1, output: 20, cacheRead: 300, cacheWrite: 4000 }) }] }] }),
      measure: 'tokens',
      window: usageWindowOf('24h', NOW),
    });

    expect(chart.columns.at(-1)?.total).toBe(4321);
  });

  it('shows the estimated cost when asked for it', () => {
    const chart = chartOf({
      usage: usageOf({ series: [MAC], buckets: [{ at: '2026-10-28T08:00:00.000Z', amounts: [{ series: 0, ...amounts({ input: 1 }, 2.5) }] }] }),
      measure: 'cost',
      window: usageWindowOf('24h', NOW),
    });

    expect(chart.columns.at(-1)?.total).toBe(2.5);
  });

  it('keeps each token kind of a column for its tooltip, over all its series', () => {
    const chart = chartOf({
      usage: usageOf({
        series: [MAC, LINUX],
        buckets: [{ at: '2026-10-28T08:00:00.000Z', amounts: [{ series: 0, ...amounts({ input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }) }, { series: 1, ...amounts({ input: 10, output: 20, cacheRead: 30, cacheWrite: 40 }) }] }],
      }),
      measure: 'tokens',
      window: usageWindowOf('24h', NOW),
    });

    expect(chart.columns.at(-1)?.kinds).toEqual({ input: 11, output: 22, cacheRead: 33, cacheWrite: 44 });
  });

  it('keeps the series as the plugin ranked and named them, other last and not coloured', () => {
    const chart = chartOf({
      usage: usageOf({ series: [{ ...MAC, amounts: amounts({ input: 90 }) }, { ...LINUX, amounts: amounts({ input: 10 }) }, { ...OTHER, amounts: amounts({ input: 5 }) }] }),
      measure: 'tokens',
      window: usageWindowOf('24h', NOW),
    });

    expect(chart.series.map(({ name, total }) => ({ name, total }))).toEqual([
      { name: 'trierarch-mac', total: 90 },
      { name: 'trierarch-linux-1', total: 10 },
      { name: 'Other', total: 5 },
    ]);
    expect(chart.series.at(-1)?.colour).toBe('other');
  });

  it('names what the plugin leaves unnamed: a login not reported, a ship the fleet does not know, usage unsplit and each token kind', () => {
    const named = (key: Series['key'], name: string | null) => chartOf({ usage: usageOf({ series: [{ key, name, amounts: NONE }] }), measure: 'tokens', window: usageWindowOf('24h', NOW) }).series[0]?.name;

    expect([
      named({ kind: 'value', value: null }, null),
      named({ kind: 'value', value: 'shp_gone' }, null),
      named({ kind: 'all' }, null),
      named({ kind: 'tokenKind', tokenKind: 'cacheRead' }, null),
    ]).toEqual(['Not reported', 'shp_gone', 'All usage', 'Cache read']);
  });

  it('colours a series by what it is, not by its rank', () => {
    const colourOfMac = (series: Series[]) => chartOf({ usage: usageOf({ series }), measure: 'tokens', window: usageWindowOf('24h', NOW) }).series.find((one) => one.name === 'trierarch-mac')?.colour;

    expect(colourOfMac([MAC, LINUX])).toBe(colourOfMac([LINUX, MAC]));
    expect(colourOfMac([MAC])).toBe(colourOfMac([LINUX, MAC]));
  });

  it('gives the series on screen different colours', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((value) => machine(`shp_${value}`, value));
    const chart = chartOf({ usage: usageOf({ series: many }), measure: 'tokens', window: usageWindowOf('24h', NOW) });

    expect(new Set(chart.series.map((series) => series.colour)).size).toBe(7);
  });

  it('gives each token kind its own colour', () => {
    const kinds = (['input', 'output', 'cacheRead', 'cacheWrite'] as const).map((tokenKind): Series => ({ key: { kind: 'tokenKind', tokenKind }, name: null, amounts: NONE }));
    const chart = chartOf({ usage: usageOf({ series: kinds }), measure: 'tokens', window: usageWindowOf('24h', NOW) });

    expect(chart.series.map((series) => series.colour)).toEqual(['s1', 's2', 's3', 's4']);
  });
});

describe('the totals of a range', () => {
  it('add up the tokens of all four kinds, with the estimated cost and what is not priced', () => {
    const totals = totalsOf(usageOf({ totals: { ...amounts({ input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }, 12.5), unpricedTokens: 7 }, unpricedModels: ['gpt-6-sol'] }));

    expect(totals).toEqual({ tokens: 10, estimatedCostUsd: 12.5, unpricedTokens: 7, unpricedModels: ['gpt-6-sol'] });
  });
});

describe('the time axis', () => {
  const FORMAT = { locale: 'en-GB', timeZone: 'Europe/Brussels' };
  const hours = { ...FORMAT, grain: 'hour' } as const;
  const days = { ...FORMAT, grain: 'day' } as const;

  it('names an hour in the viewer time zone', () => {
    expect(columnLabelOf('2026-10-28T09:00:00.000Z', hours)).toBe('Wed 28 Oct, 10:00');
  });

  it('names a day in UTC, whatever the viewer time zone', () => {
    expect(columnLabelOf('2026-10-28T23:00:00.000Z', days)).toBe('Wed 28 Oct');
  });

  it('marks every sixth hour of a day of hours', () => {
    const chart = chartOf({ usage: usageOf({}), measure: 'tokens', window: usageWindowOf('24h', NOW) });

    expect(axisTicksOf(chart.columns, hours).map((tick) => tick.label).slice(0, 3)).toEqual(['10:00', '16:00', '22:00']);
  });

  it('marks every day of 7 days of hours, by weekday and date', () => {
    const chart = chartOf({ usage: usageOf({}), measure: 'tokens', window: usageWindowOf('7d', NOW) });
    const ticks = axisTicksOf(chart.columns, hours);

    expect(ticks).toHaveLength(7);
    expect(ticks[0]?.label).toBe('Wed 21');
  });

  it('marks every week of 30 days and every two weeks of 90 days, in UTC', () => {
    const thirty = chartOf({ usage: usageOf({ grain: 'day' }), measure: 'tokens', window: usageWindowOf('30d', NOW) });
    const ninety = chartOf({ usage: usageOf({ grain: 'day' }), measure: 'tokens', window: usageWindowOf('90d', NOW) });

    expect(axisTicksOf(thirty.columns, days).map((tick) => tick.label).slice(0, 2)).toEqual(['29 Sept', '6 Oct']);
    expect(axisTicksOf(ninety.columns, days).map((tick) => tick.label).slice(0, 2)).toEqual(['31 Jul', '14 Aug']);
  });
});
