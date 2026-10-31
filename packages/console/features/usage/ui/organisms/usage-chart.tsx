'use client';

import { useState } from 'react';

import { niceMaxOf } from '../../services/usage-axis';
import { axisTicksOf, columnLabelOf, TOKEN_KIND_NAMES, TOKEN_KINDS, type TimeFormat, type UsageChart as UsageChartData } from '../../services/usage-chart';
import { tokensWords } from '../../services/usage-format';
import { SERIES_FILL } from '../molecules/series-fill';

interface UsageChartProps {
  chart: UsageChartData;
  format: TimeFormat;
  /** Writes a value of the measure: tokens or dollars. */
  formatValue: (value: number) => string;
}

// The drawing's own units; the SVG scales to its box.
const WIDTH = 1000;
const HEIGHT = 300;
const LEFT = 52;
const RIGHT = 8;
const TOP = 10;
const BOTTOM = 40;
const GRIDLINES = 4;
const THIN_COLUMNS = 100;
const GAP = 2;
const GAP_THIN = 0.5;
const SEGMENT_GAP = 1;
const CORNER = 2;
const TOOLTIP_FLIPS_PAST = 0.5;

/**
 * One stacked column chart (docs/design/usage/mockup), drawn as plain SVG: a
 * column per hour or UTC day, the series stacked in the order the plugin
 * ranked them, Other on top. Hovering a column opens a tooltip with the
 * measure per series and each token kind. The table view is the way to read
 * every number by keyboard.
 */
export function UsageChart({ chart, format, formatValue }: UsageChartProps) {
  const [activeIndex, setActiveIndex] = useState<number | undefined>(undefined);
  const { columns, series } = chart;
  const top = niceMaxOf(Math.max(0, ...columns.map((column) => column.total)));
  const plotWidth = WIDTH - LEFT - RIGHT;
  const plotHeight = HEIGHT - TOP - BOTTOM;
  const columnWidth = plotWidth / columns.length;
  const gap = columns.length > THIN_COLUMNS ? GAP_THIN : GAP;
  const yOf = (value: number) => TOP + plotHeight * (1 - value / top);
  const seriesById = new Map(series.map((one) => [one.id, one]));
  const ticks = axisTicksOf(columns, format);
  const active = activeIndex === undefined ? undefined : columns[activeIndex];
  const activeCentre = activeIndex === undefined ? 0 : (LEFT + (activeIndex + 0.5) * columnWidth) / WIDTH;

  return (
    <div className="relative min-w-0" data-testid="usage-chart" onMouseLeave={() => { setActiveIndex(undefined); }}>
      <svg viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`} role="img" aria-label="Stacked columns of usage over time; the table shows every number" className="block h-auto w-full overflow-visible">
        {Array.from({ length: GRIDLINES + 1 }, (_, line) => {
          const value = (top * line) / GRIDLINES;
          return (
            <g key={value}>
              <line x1={LEFT} x2={WIDTH - RIGHT} y1={yOf(value)} y2={yOf(value)} className="stroke-chart-grid" strokeWidth={1} />
              <text x={LEFT - 8} y={yOf(value) + 4} textAnchor="end" className="fill-muted-foreground text-micro tabular-nums">
                {formatValue(value)}
              </text>
            </g>
          );
        })}
        {columns.map((column, index) => {
          let stacked = 0;
          const x = LEFT + index * columnWidth + gap / 2;
          return (
            <g key={column.at} data-testid="usage-column" data-at={column.at}>
              {column.segments.map((segment, position) => {
                const bottom = yOf(stacked);
                stacked += segment.value;
                const topOfSegment = yOf(stacked);
                const isTopmost = position === column.segments.length - 1;
                const colour = seriesById.get(segment.seriesId)?.colour ?? 'other';
                return (
                  <rect
                    key={segment.seriesId}
                    x={x}
                    y={topOfSegment}
                    width={Math.max(1, columnWidth - gap)}
                    height={Math.max(0, bottom - topOfSegment - (isTopmost || columns.length > THIN_COLUMNS ? 0 : SEGMENT_GAP))}
                    rx={isTopmost && columns.length <= THIN_COLUMNS ? CORNER : 0}
                    className={SERIES_FILL[colour].fill}
                  />
                );
              })}
              <rect
                x={LEFT + index * columnWidth}
                y={TOP}
                width={columnWidth}
                height={plotHeight}
                className={index === activeIndex ? 'fill-foreground/8' : 'fill-transparent'}
                data-testid="usage-column-hit"
                onMouseEnter={() => { setActiveIndex(index); }}
              />
            </g>
          );
        })}
        <line x1={LEFT} x2={WIDTH - RIGHT} y1={yOf(0)} y2={yOf(0)} className="stroke-border" strokeWidth={1} />
        {ticks.map((tick) => (
          <text key={tick.index} x={LEFT + tick.index * columnWidth} y={HEIGHT - 22} className="fill-muted-foreground text-micro tabular-nums">
            {tick.label}
          </text>
        ))}
        <text x={WIDTH - RIGHT} y={HEIGHT - 4} textAnchor="end" className="fill-muted-foreground text-micro" data-testid="usage-axis-caption">
          {format.grain === 'day' ? 'days in UTC' : 'hours in your time zone'}
        </text>
      </svg>
      {active === undefined ? null : (
        <div
          role="status"
          data-testid="usage-tooltip"
          style={{ left: `${String(activeCentre * 100)}%` }}
          className={`pointer-events-none absolute top-2 z-10 min-w-52 rounded-lg border border-border bg-popover p-2.5 text-caption text-popover-foreground shadow-lg ${activeCentre > TOOLTIP_FLIPS_PAST ? '-translate-x-[calc(100%+var(--spacing)*3)]' : 'translate-x-3'}`}
        >
          <p className="mb-1 text-meta font-semibold">{columnLabelOf(active.at, format)}</p>
          {active.segments.map((segment) => {
            const one = seriesById.get(segment.seriesId);
            return (
              <p key={segment.seriesId} className="flex justify-between gap-2">
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className={`size-2 rounded-xs ${SERIES_FILL[one?.colour ?? 'other'].background}`} />
                  {one?.name}
                </span>
                <span className="tabular-nums">{formatValue(segment.value)}</span>
              </p>
            );
          })}
          <p className="mt-1 flex justify-between gap-2 border-t border-border pt-1 font-medium">
            <span>Total</span>
            <span className="tabular-nums" data-testid="usage-tooltip-total">{formatValue(active.total)}</span>
          </p>
          <ul className="mt-1 text-muted-foreground" data-testid="usage-tooltip-kinds">
            {TOKEN_KINDS.map((kind) => (
              <li key={kind} className="flex justify-between gap-2">
                <span>{TOKEN_KIND_NAMES[kind]}</span>
                <span className="tabular-nums">{tokensWords(active.kinds[kind])}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
