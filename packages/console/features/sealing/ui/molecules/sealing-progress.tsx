import { progressOf } from '../../services/sealing-view';

/**
 * How far the sealing pass is with what the fleet stored before it turned
 * sealing on (ES2): a bar and "2,180 of 3,412 payloads sealed", announced
 * politely as it moves.
 */
export function SealingProgress({ progress }: { progress: { sealed: number; total: number } }) {
  const { words, percent } = progressOf(progress);
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <div role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.sealed} aria-label={words} className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-[width] duration-(--duration-base)" style={{ width: `${String(percent)}%` }} />
      </div>
      <p role="status" aria-live="polite" className="text-meta text-muted-foreground tabular-nums" data-testid="sealing-progress">
        {words}
        <span className="max-sm:hidden">. Sends and receives go on meanwhile.</span>
      </p>
    </div>
  );
}
