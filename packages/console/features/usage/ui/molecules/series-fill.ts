import type { SeriesColour } from '../../services/usage-chart';

/** A series colour as the classes that paint it; written out whole so Tailwind finds them. */
export const SERIES_FILL: Record<SeriesColour, { background: string; fill: string; stroke: string }> = {
  s1: { background: 'bg-series-1', fill: 'fill-series-1', stroke: 'stroke-series-1' },
  s2: { background: 'bg-series-2', fill: 'fill-series-2', stroke: 'stroke-series-2' },
  s3: { background: 'bg-series-3', fill: 'fill-series-3', stroke: 'stroke-series-3' },
  s4: { background: 'bg-series-4', fill: 'fill-series-4', stroke: 'stroke-series-4' },
  s5: { background: 'bg-series-5', fill: 'fill-series-5', stroke: 'stroke-series-5' },
  s6: { background: 'bg-series-6', fill: 'fill-series-6', stroke: 'stroke-series-6' },
  s7: { background: 'bg-series-7', fill: 'fill-series-7', stroke: 'stroke-series-7' },
  other: { background: 'bg-series-other', fill: 'fill-series-other', stroke: 'stroke-series-other' },
};
