import { Skeleton } from '../../../../components/atoms/skeleton';
import { EmptyState } from '../../../../components/molecules/empty-state';
import { InlineError } from '../../../../components/molecules/inline-error';
import { LoadMore } from '../../../../components/molecules/load-more';
import type { WindowChart } from '../../services/subscription-windows';
import { SERIES_FILL } from '../molecules/series-fill';

export type WindowsView = { kind: 'loading' } | { kind: 'cannot-read' } | { kind: 'empty' } | { kind: 'ready'; charts: readonly WindowChart[] };

interface SubscriptionWindowsCardProps {
  view: WindowsView;
  hasMore: boolean;
  isLoadingMore: boolean;
  isLoadMoreFailed: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  /** The range's two ends in words, under the lines: "27 Oct" and "now". */
  rangeStartWords: string;
}

// The drawing's own units; each chart scales to its box.
const WIDTH = 320;
const HEIGHT = 120;
const LEFT = 30;
const RIGHT = 6;
const TOP = 6;
const BOTTOM = 18;
const PERCENT_LINES = [0, 50, 100];
const FULL = 100;
const DOT = 4;

/** One machine and harness: a line per window of percent used over the range. */
function WindowsChartFigure({ chart, rangeStartWords }: { chart: WindowChart; rangeStartWords: string }) {
  const x = (at: number) => LEFT + at * (WIDTH - LEFT - RIGHT);
  const y = (percent: number) => TOP + (HEIGHT - TOP - BOTTOM) * (1 - percent / FULL);
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-3" data-testid="usage-windows-chart">
      <div className="flex flex-wrap justify-between gap-2 text-meta">
        <b className="font-semibold">{chart.machineName}</b>
        <span className="text-muted-foreground">{chart.harness}</span>
      </div>
      <svg viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`} role="img" aria-label={`Subscription windows of ${chart.harness} on ${chart.machineName}: ${chart.lines.map((line) => `${line.name} ${String(Math.round(line.latestPercent))}% used`).join(', ')}`} className="block h-auto w-full overflow-visible">
        {PERCENT_LINES.map((percent) => (
          <g key={percent}>
            <line x1={LEFT} x2={WIDTH - RIGHT} y1={y(percent)} y2={y(percent)} className="stroke-chart-grid" />
            <text x={LEFT - 6} y={y(percent) + 4} textAnchor="end" className="fill-muted-foreground text-micro tabular-nums">
              {percent}%
            </text>
          </g>
        ))}
        {chart.lines.map((line) => {
          const last = line.points.at(-1);
          const stroke = SERIES_FILL[line.colour].stroke;
          return (
            <g key={line.windowMinutes}>
              <polyline points={line.points.map((point) => `${x(point.at).toFixed(1)},${y(point.percent).toFixed(1)}`).join(' ')} fill="none" strokeWidth={2} strokeLinejoin="round" className={stroke} />
              {last === undefined ? null : <circle cx={x(last.at)} cy={y(last.percent)} r={DOT} strokeWidth={2} className={`${SERIES_FILL[line.colour].fill} stroke-card`} />}
            </g>
          );
        })}
        <text x={LEFT} y={HEIGHT - 3} className="fill-muted-foreground text-micro">
          {rangeStartWords}
        </text>
        <text x={WIDTH - RIGHT} y={HEIGHT - 3} textAnchor="end" className="fill-muted-foreground text-micro">
          now
        </text>
      </svg>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-caption">
        {chart.lines.map((line) => (
          <li key={line.windowMinutes} className="flex items-center gap-1.5">
            <span aria-hidden className={`size-2.5 rounded-xs ${SERIES_FILL[line.colour].background}`} />
            {line.name}
            <span className="text-muted-foreground tabular-nums">{Math.round(line.latestPercent)}%</span>
          </li>
        ))}
      </ul>
    </li>
  );
}

/**
 * The Subscription windows card (usage design, U6 and "The console"): how full
 * each harness's subscription was, a small line chart per machine and harness,
 * one line per window, percent used over the page's range. A harness that
 * cannot say its windows has no chart. Twenty charts a page, then Load more.
 */
export function SubscriptionWindowsCard({ view, hasMore, isLoadingMore, isLoadMoreFailed, onLoadMore, onRetry, rangeStartWords }: SubscriptionWindowsCardProps) {
  return (
    <section aria-label="Subscription windows" data-testid="usage-windows" className="flex min-w-0 flex-col gap-3.5 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-section font-semibold">Subscription windows</h2>
        <p className="text-meta text-muted-foreground">How full each harness’s subscription was, per machine, as its trierarch read it. Two machines on one login show the same windows.</p>
      </div>
      {view.kind === 'loading' ? (
        <div role="status" data-testid="usage-windows-loading" className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
          <span className="sr-only">Loading subscription windows</span>
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
        </div>
      ) : null}
      {view.kind === 'cannot-read' ? (
        <div data-testid="usage-windows-cannot-read">
          <InlineError title="Subscription windows cannot be read now: the trierarch plugin does not answer" description="Nothing was lost. Try again in a moment." onRetry={onRetry} />
        </div>
      ) : null}
      {view.kind === 'empty' ? (
        <div data-testid="usage-windows-empty">
          <EmptyState variant="section" title="No subscription windows in this range" />
        </div>
      ) : null}
      {view.kind === 'ready' ? (
        <>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
            {view.charts.map((chart) => (
              <WindowsChartFigure key={`${chart.machineShipId}-${chart.harness}`} chart={chart} rangeStartWords={rangeStartWords} />
            ))}
          </ul>
          <p className="text-caption text-muted-foreground">Each reading as the trierarch took it: at its start, then at most every 30 minutes with work since. The range and the machine and harness filters above apply here too.</p>
          {hasMore || isLoadMoreFailed ? <LoadMore what="more machines" isLoading={isLoadingMore} isFailed={isLoadMoreFailed} onLoad={onLoadMore} area="usage-windows" /> : null}
        </>
      ) : null}
    </section>
  );
}
