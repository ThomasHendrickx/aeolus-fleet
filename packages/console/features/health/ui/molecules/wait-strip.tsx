import { classNames } from '@aeolus-fleet/common/header';
import { WAIT_TICKS, waitPosition } from '../../services/health-view';

interface WaitStripProps {
  /** How long each delivery has waited, in minutes. */
  waits: readonly number[];
  /** Spoken: how many wait and how long the oldest. */
  label: string;
  className?: string;
}

const CLOCK_FROM = 10;
const CLOCK_TO = 60;

function percent(minutes: number): string {
  return `${waitPosition(minutes) * 100}%`;
}

/**
 * One place's deliveries on the shared wait scale (mock-up A): 1 min to 7 d,
 * log, the same in every card, so how long reads as position. The band
 * between 10 and 60 minutes shades the pushed clocks; a line runs to the
 * oldest, a dot for each delivery.
 */
export function WaitStrip({ waits, label, className }: WaitStripProps) {
  const oldest = Math.max(0, ...waits);
  return (
    <div role="img" aria-label={label} data-testid="health-wait-strip" className={classNames('relative h-4 w-full', className)}>
      <span aria-hidden className="absolute inset-y-0 rounded-xs bg-muted" style={{ left: percent(CLOCK_FROM), right: `calc(100% - ${percent(CLOCK_TO)})` }} />
      <span aria-hidden className="absolute inset-x-0 top-1/2 h-px bg-border" />
      {WAIT_TICKS.map((tick) => (
        <span key={tick.minutes} aria-hidden className="absolute top-1/4 h-1/2 w-px bg-border" style={{ left: percent(tick.minutes) }} />
      ))}
      <span aria-hidden className="absolute top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-foreground opacity-35" style={{ left: 0, width: percent(oldest) }} />
      {waits.map((minutes, index) => (
        <span
          key={`${minutes}-${String(index)}`}
          aria-hidden
          className="absolute top-1/2 size-2.5 -translate-1/2 rounded-full border-2 border-card bg-foreground"
          style={{ left: percent(minutes) }}
        />
      ))}
    </div>
  );
}

/** The ticks of the shared wait scale, under a column of strips. */
export function WaitAxis({ className }: { className?: string }) {
  return (
    <div aria-hidden className={classNames('relative h-4 w-full text-micro text-muted-foreground', className)}>
      {WAIT_TICKS.map((tick, index) => (
        <span
          key={tick.minutes}
          className={classNames('absolute whitespace-nowrap', index === 0 ? '' : index === WAIT_TICKS.length - 1 ? '-translate-x-full' : '-translate-x-1/2')}
          style={{ left: percent(tick.minutes) }}
        >
          {tick.label}
        </span>
      ))}
    </div>
  );
}
