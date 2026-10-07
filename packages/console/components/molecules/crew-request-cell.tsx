import { classNames } from '../../lib/class-names';
import type { CrewRequestCell as Cell } from '../../lib/needs-crew';

const DOT_TONES = {
  waiting: 'bg-tone-waiting-fg',
  active: 'bg-tone-active-fg',
  ok: 'bg-tone-ok-fg',
  attention: 'bg-tone-attention-fg',
} as const;

/**
 * A crew request in a table (canvas CrewRequest, "In tables"): a tone dot and
 * a word, no pill, so it reads without colour; a dash without a request.
 */
export function CrewRequestCell({ cell, testId }: { cell: Cell; testId?: string }) {
  if (cell === undefined) {
    return (
      <span className="text-meta text-muted-foreground" data-testid={testId}>
        <span aria-hidden>–</span>
        <span className="sr-only">No crew request</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-meta whitespace-nowrap" data-testid={testId}>
      <span aria-hidden className={classNames('size-1.5 shrink-0 rounded-full', DOT_TONES[cell.tone])} />
      {cell.word}
    </span>
  );
}
