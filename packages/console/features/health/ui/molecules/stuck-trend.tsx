import { dayMonth } from '../../../../lib/relative-time';
import type { TrendMark } from '../../services/health-view';

interface StuckTrendProps {
  /** Stuck deliveries at each hour of the last 7 days, oldest first, the last one now. */
  perHour: readonly { at: string; count: number }[];
  /** Numbered marks for where a place's oldest wait began. */
  marks: readonly TrendMark[];
}

const HOURS_A_DAY = 24;
const GRID_STEP = 5;
const WIDTH = 1000;
const HEIGHT = 100;

/** The top of the scale: the highest count, rounded up to the next grid step, never under one step. */
function topOf(perHour: StuckTrendProps['perHour']): number {
  const highest = Math.max(0, ...perHour.map((hour) => hour.count));
  return Math.max(GRID_STEP, Math.ceil(highest / GRID_STEP) * GRID_STEP);
}

/**
 * Stuck deliveries per hour over the last 7 days (mock-up A): a step line in
 * the waiting tone over a muted area, the day under each 24 hours, and a
 * numbered mark where each place's oldest wait began. The line is SVG; the
 * labels and marks are text placed by percent, so they stay sharp at any
 * width. On phone the marks move into the legend only.
 */
export function StuckTrend({ perHour, marks }: StuckTrendProps) {
  const top = topOf(perHour);
  const last = Math.max(perHour.length - 1, 1);
  const x = (index: number) => (index / last) * WIDTH;
  const y = (count: number) => HEIGHT - (count / top) * HEIGHT;
  const [first] = perHour;
  const steps = perHour.slice(1).map((hour, index) => `H${x(index + 1)} V${y(hour.count)}`);
  const line = [`M0 ${y(first?.count ?? 0)}`, ...steps].join(' ');
  const area = `${line} H${WIDTH} V${HEIGHT} H0 Z`;
  const now = perHour.at(-1)?.count ?? 0;
  const days = perHour.flatMap((hour, index) => (index % HOURS_A_DAY === HOURS_A_DAY / 2 ? [{ index, label: dayMonth(new Date(hour.at)) }] : []));

  return (
    <figure data-testid="health-trend" className="flex min-w-0 flex-col gap-2">
      <figcaption className="text-meta font-medium text-foreground">Stuck deliveries, last 7 days, per hour</figcaption>
      <div className="grid grid-cols-[auto_1fr] gap-x-2">
        <div aria-hidden className="relative h-36 w-5 text-caption tabular-nums text-muted-foreground">
          {[top, top / 2, 0].map((value) => (
            <span key={value} className="absolute right-0 -translate-y-1/2" style={{ top: `${100 - (value / top) * 100}%` }}>
              {value}
            </span>
          ))}
        </div>
        <div className="relative h-36">
          <svg
            role="img"
            aria-label={`Stuck deliveries per hour over the last 7 days: ${now} now, at most ${Math.max(0, ...perHour.map((hour) => hour.count))}`}
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            preserveAspectRatio="none"
            className="size-full overflow-visible"
          >
            {[0, top / 2, top].map((value) => (
              <line key={value} x1={0} x2={WIDTH} y1={y(value)} y2={y(value)} className="stroke-border" vectorEffect="non-scaling-stroke" />
            ))}
            <path d={area} className="fill-tone-waiting-bg" />
            <path d={line} className="fill-none stroke-tone-waiting-fg" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </svg>
          {marks.map((mark) => (
            <span
              key={mark.number}
              aria-hidden
              data-testid="health-trend-mark"
              className="absolute flex size-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-foreground bg-card text-micro font-semibold text-foreground max-sm:hidden"
              style={{ left: `${(mark.hour / last) * 100}%`, top: `${(y(perHour[mark.hour]?.count ?? 0) / HEIGHT) * 100}%` }}
            >
              {mark.number}
            </span>
          ))}
          <span
            aria-hidden
            className="absolute size-2 -translate-1/2 rounded-full bg-tone-waiting-fg"
            style={{ left: '100%', top: `${(y(now) / HEIGHT) * 100}%` }}
          />
        </div>
        <div aria-hidden className="relative col-start-2 h-4 text-caption text-muted-foreground">
          {days.map((day) => (
            <span key={day.index} className="absolute -translate-x-1/2 whitespace-nowrap max-sm:[&:nth-child(even)]:hidden" style={{ left: `${(day.index / last) * 100}%` }}>
              {day.label}
            </span>
          ))}
        </div>
      </div>
      {marks.length > 0 && (
        <p className="text-meta text-muted-foreground">
          {marks.map((mark, index) => (
            <span key={mark.number}>
              {index > 0 && ' · '}
              <span className="font-semibold text-foreground">{mark.number}</span> {mark.label}
            </span>
          ))}
        </p>
      )}
    </figure>
  );
}
