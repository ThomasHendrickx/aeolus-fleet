import type { WindowsPage } from '../../../lib/trierarch-plugin-schemas';
import type { SeriesColour } from './usage-chart';
import type { UsageWindow } from './usage-window';

/**
 * What the Subscription windows card draws of `usage.windows`: per machine and
 * harness, a line per window of percent used over the range. Pure. A harness
 * with no reading in the range cannot say its windows and is left out.
 */

export interface WindowLine {
  windowMinutes: number;
  name: string;
  colour: SeriesColour;
  /** Each reading: where it falls in the range (0 the start, 1 the end) and the percent used. Oldest first. */
  points: { at: number; percent: number }[];
  latestPercent: number;
}

export interface WindowChart {
  machineShipId: string;
  machineName: string;
  harness: string;
  lines: WindowLine[];
}

const MINUTES_IN_HOUR = 60;
const MINUTES_IN_DAY = 1440;

function countOf(count: number, unit: string): string {
  return `${String(count)} ${unit}${count === 1 ? '' : 's'}`;
}

/** A window's length in words: 5 hours, 7 days. */
export function windowNameOf(minutes: number): string {
  if (minutes % MINUTES_IN_DAY === 0) {
    return countOf(minutes / MINUTES_IN_DAY, 'day');
  }
  return minutes % MINUTES_IN_HOUR === 0 ? countOf(minutes / MINUTES_IN_HOUR, 'hour') : countOf(minutes, 'minute');
}

/** The line colours by window length: the two lengths the harnesses use today keep theirs on every chart, any other length takes the third. */
const KNOWN_WINDOW_MINUTES = [300, 10_080];
const KNOWN_COLOURS: readonly SeriesColour[] = ['s1', 's2'];
const OTHER_WINDOW_COLOUR: SeriesColour = 's3';

function colourOfWindow(minutes: number): SeriesColour {
  return KNOWN_COLOURS[KNOWN_WINDOW_MINUTES.indexOf(minutes)] ?? OTHER_WINDOW_COLOUR;
}

export function windowChartsOf(input: { charts: WindowsPage['charts']; window: UsageWindow }): WindowChart[] {
  const start = Date.parse(input.window.from);
  const length = Date.parse(input.window.to) - start;
  return input.charts.flatMap((chart) => {
    const lines = chart.windows
      .filter((one) => one.readings.length > 0)
      .map((one): WindowLine => {
        const points = one.readings.map((reading) => ({ at: (Date.parse(reading.readAt) - start) / length, percent: reading.usedPercent }));
        return { windowMinutes: one.windowMinutes, name: windowNameOf(one.windowMinutes), colour: colourOfWindow(one.windowMinutes), points, latestPercent: points.at(-1)?.percent ?? 0 };
      });
    return lines.length === 0 ? [] : [{ machineShipId: chart.machineShipId, machineName: chart.machineName ?? chart.machineShipId, harness: chart.harness, lines }];
  });
}
