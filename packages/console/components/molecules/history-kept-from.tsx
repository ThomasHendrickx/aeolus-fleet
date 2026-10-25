import { History } from 'lucide-react';

import { keptFromLine } from '../../lib/limits';

interface HistoryKeptFromProps {
  /** Where the fleet's kept history begins, as fleet.limits gives it; null while nothing was pruned, and nothing shows. */
  keptFrom: string | null;
  /** The area of the page it closes, for its test id: `{area}-kept-from`. */
  area: string;
}

/** Under a list of the fleet's history (the timeline, the threads, Health): where its kept history begins, so nothing goes silently (retention design, R10). */
export function HistoryKeptFrom({ keptFrom, area }: HistoryKeptFromProps) {
  if (keptFrom === null) {
    return null;
  }
  return (
    <p data-testid={`${area}-kept-from`} className="flex items-start gap-2 text-meta text-muted-foreground">
      <History aria-hidden className="mt-0.5 size-(--size-icon-sm) shrink-0" />
      <span>{keptFromLine(keptFrom)}</span>
    </p>
  );
}
