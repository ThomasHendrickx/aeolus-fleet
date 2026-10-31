import type { ChartSeries } from '../../services/usage-chart';
import { SERIES_FILL } from './series-fill';

/** The series on the chart with their totals in the measure, each swatch beside its name so colour is never the only key. */
export function UsageLegend({ series, formatValue }: { series: readonly ChartSeries[]; formatValue: (value: number) => string }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-body" data-testid="usage-legend" aria-label="Series">
      {series.map((one) => (
        <li key={one.id} className="flex items-center gap-1.5">
          <span aria-hidden className={`size-2.5 rounded-xs ${SERIES_FILL[one.colour].background}`} />
          <span>{one.name}</span>
          <span className="text-muted-foreground tabular-nums">{formatValue(one.total)}</span>
        </li>
      ))}
    </ul>
  );
}
