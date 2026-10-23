import { ChevronsDown } from 'lucide-react';

import { Button } from '@aeolus-fleet/common/header';

import { InlineError } from './inline-error';

interface LoadMoreProps {
  /** What the next page holds, in the list's words: "older events". */
  what: string;
  /** Whether the next page is on its way. */
  isLoading: boolean;
  /** Whether the last try to load it failed. */
  isFailed: boolean;
  onLoad: () => void;
  /** The list's area, for `{area}-load-more`. */
  area: string;
}

/**
 * The end of a paged list with more to come (decision 4 of
 * docs/design/performance/performance.md): Load more, working while the next
 * page comes, and when it fails, what failed with Try again, the rows already
 * shown kept.
 */
export function LoadMore({ what, isLoading, isFailed, onLoad, area }: LoadMoreProps) {
  if (isFailed) {
    return <InlineError title={`Couldn’t load ${what}`} description="What is shown stays as it is. Try again in a moment." onRetry={onLoad} className="m-3" />;
  }
  return (
    <div className="flex justify-center border-t border-border px-3.5 py-2.5">
      <Button size="sm" variant="ghost" icon={<ChevronsDown aria-hidden />} isLoading={isLoading} onClick={onLoad} data-testid={`${area}-load-more`}>
        {isLoading ? `Loading ${what}...` : `Load ${what}`}
      </Button>
    </div>
  );
}
