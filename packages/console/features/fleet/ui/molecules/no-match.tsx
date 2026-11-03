import { SearchX } from 'lucide-react';

import { Button } from '@aeolus-fleet/ui';
import { counted } from '../../../../lib/sentence';

/**
 * No ship matches the overview bar's search and filters, in either view
 * (docs/design/fleet-overview): what was asked, that the fleet has ships
 * none of which is in this view, and the way back: Clear search, Clear
 * filters, or both.
 */
export function NoMatch({ query, hasFilters, fleetShips, onClear }: { query: string; hasFilters: boolean; fleetShips: number | undefined; onClear: () => void }) {
  const needle = query.trim();
  return (
    <div data-testid="fleet-no-match" className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card px-6 py-10 text-center">
      <span aria-hidden className="flex size-9 items-center justify-center rounded-lg bg-secondary text-muted-foreground [&_svg]:size-4.5">
        <SearchX />
      </span>
      <p className="text-body font-semibold text-foreground">{needle === '' ? 'No ships match these filters.' : `No ships match “${needle}”.`}</p>
      {fleetShips === undefined ? null : <p className="text-meta text-muted-foreground">The fleet has {counted(fleetShips, { one: 'ship', many: 'ships' })}; none of them is in this view.</p>}
      <Button size="xs" data-testid="fleet-clear-filters" onClick={onClear}>
        {needle === '' ? 'Clear filters' : hasFilters ? 'Clear search and filters' : 'Clear search'}
      </Button>
    </div>
  );
}
