import { classNames } from '../../lib/class-names';

interface StationProgressProps {
  /** Members on station (forming) or done (standing down). */
  done: number;
  total: number;
  variant: 'forming' | 'standdown';
  className?: string;
}

const WORDS = {
  forming: { done: 'on station', next: 'Sails when all are on station' },
  standdown: { done: 'finished their work', next: 'Disbands when all are done' },
} as const;

/**
 * How far a squadron is in its current transition
 * (docs/design/png/StationProgress.png, canvas SqForming and SqStanding): one
 * segment per member, filled as members go on station while Forming or finish
 * while Standing down, with what happens when all have. Announced politely as
 * it changes.
 */
export function StationProgress({ done, total, variant, className }: StationProgressProps) {
  const words = WORDS[variant];
  const members = total === 1 ? 'member' : 'members';
  return (
    <div
      data-slot="station-progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-label={`${String(done)} of ${String(total)} ${members} ${words.done}`}
      className={classNames('flex flex-col gap-1.5', className)}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-meta">
        <p role="status" aria-live="polite" className="text-foreground" data-testid="station-progress">
          <span className="font-medium">
            {done} of {total} {members}
          </span>{' '}
          {words.done}
        </p>
        <span className="text-muted-foreground">{words.next}</span>
      </div>
      <div aria-hidden className="flex gap-1">
        {Array.from({ length: total }, (_unused, index) => (
          <span key={`segment-${String(index)}`} className={classNames('h-1.5 grow rounded-full', index < done ? 'bg-tone-ok-fg' : 'bg-muted')} />
        ))}
      </div>
    </div>
  );
}
