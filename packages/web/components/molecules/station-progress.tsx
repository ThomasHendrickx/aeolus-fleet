import { classNames } from '../../lib/class-names';

interface StationProgressProps {
  /** Members on station (forming) or done (standing down). */
  done: number;
  total: number;
  variant: 'forming' | 'standdown';
  className?: string;
}

/**
 * How far a squadron is in its current transition
 * (docs/design/png/StationProgress.png): one segment per member, filled as
 * members go on station while Forming. Announced politely as it changes.
 */
export function StationProgress({ done, total, variant, className }: StationProgressProps) {
  const label = variant === 'forming' ? `${String(done)} of ${String(total)} on station` : `${String(done)} of ${String(total)} done`;
  return (
    <div data-slot="station-progress" className={classNames('flex flex-col gap-1.5', className)}>
      <div aria-hidden className="flex gap-1">
        {Array.from({ length: total }, (_unused, index) => (
          <span key={`segment-${String(index)}`} className={classNames('h-1.5 grow rounded-full', index < done ? 'bg-tone-ok-fg' : 'bg-muted')} />
        ))}
      </div>
      <p role="status" aria-live="polite" className="text-meta text-muted-foreground" data-testid="station-progress">
        {label}
      </p>
    </div>
  );
}
