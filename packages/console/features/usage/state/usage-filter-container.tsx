'use client';

import { useUsageValues } from '../hooks/usage';
import { filterItemsOf, pickedKeysOf } from '../services/usage-filters';
import type { UsageBreakdownName } from '../services/usage-state';
import type { UsageWindow } from '../services/usage-window';
import { UsageFilter } from '../ui/molecules/usage-filter';

interface UsageFilterContainerProps {
  breakdown: UsageBreakdownName;
  /** The breakdown in the singular: "Machine". */
  label: string;
  period: UsageWindow;
  picked: readonly (string | null)[];
  onPickedChange: (keys: string[]) => void;
}

/** One filter of the Usage page, fed by the values of its breakdown in the range (`usage.values`). */
export function UsageFilterContainer({ breakdown, label, period, picked, onPickedChange }: UsageFilterContainerProps) {
  const values = useUsageValues({ from: period.from, to: period.to, breakdown });
  return (
    <UsageFilter
      label={label}
      items={values.page === undefined ? undefined : filterItemsOf(values.page)}
      picked={pickedKeysOf(picked)}
      onPickedChange={onPickedChange}
      isFailed={values.isFailed}
      hasMore={values.page?.nextCursor != null}
      isLoadingMore={values.isLoadingMore}
      onLoadMore={values.loadMore}
      testId={`usage-filter-${breakdown}`}
    />
  );
}
