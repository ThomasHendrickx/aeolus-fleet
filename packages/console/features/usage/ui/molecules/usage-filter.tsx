'use client';

import { ChevronsDown } from 'lucide-react';

import { Button } from '@aeolus-fleet/ui';

import { Select, SelectContent, SelectItem, SelectTrigger } from '../../../../components/atoms/select';
import { tokensWords } from '../../services/usage-format';
import type { FilterItem } from '../../services/usage-filters';

interface UsageFilterProps {
  /** The breakdown, in the singular: "Machine". */
  label: string;
  /** The values read so far; undefined while the first page loads. */
  items: readonly FilterItem[] | undefined;
  /** The keys picked, in the order picked; none is no filter. */
  picked: readonly string[];
  onPickedChange: (picked: string[]) => void;
  /** Whether the menu's first page could not be read. */
  isFailed?: boolean;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
  /** The filter's area, for `{testId}`. */
  testId: string;
}

/**
 * A filter on one breakdown (usage design, U6): the themed Select, several
 * values picked, each offered with its tokens in the range as `usage.values`
 * answers them, 20 a page with Load more. The trigger names the one value
 * picked or counts several; none picked reads All.
 */
export function UsageFilter({ label, items, picked, onPickedChange, isFailed = false, hasMore = false, isLoadingMore = false, onLoadMore, testId }: UsageFilterProps) {
  const wordOf = (key: string) => items?.find((item) => item.key === key)?.word ?? key;
  const [first] = picked;
  return (
    <Select
      multiple
      value={[...picked]}
      onValueChange={(next) => {
        onPickedChange(next);
      }}
    >
      <SelectTrigger aria-label={`${label} filter`} data-testid={testId}>
        <span className="flex items-center gap-1.5">
          <span className="text-muted-foreground">{label}</span>
          {picked.length > 1 ? (
            <span className="inline-flex size-5 items-center justify-center rounded-full bg-primary text-caption font-semibold text-primary-foreground tabular-nums">
              {picked.length}
              <span className="sr-only"> picked</span>
            </span>
          ) : (
            <span className="font-medium">{first === undefined ? 'All' : wordOf(first)}</span>
          )}
        </span>
      </SelectTrigger>
      <SelectContent>
        {items === undefined ? <p className="px-2.5 py-1.5 text-meta text-muted-foreground">{isFailed ? `Couldn’t read the ${label.toLowerCase()} values` : 'Loading...'}</p> : null}
        {items?.length === 0 ? <p className="px-2.5 py-1.5 text-meta text-muted-foreground">No usage in this range</p> : null}
        {items?.map((item) => (
          <SelectItem key={item.key} value={item.key}>
            <span className="flex items-baseline gap-2">
              {item.word}
              <span className="text-caption text-muted-foreground tabular-nums">{tokensWords(item.tokens)}</span>
            </span>
          </SelectItem>
        ))}
        {hasMore ? (
          <Button size="sm" variant="ghost" icon={<ChevronsDown aria-hidden />} isLoading={isLoadingMore} onClick={onLoadMore} data-testid={`${testId}-load-more`}>
            {isLoadingMore ? 'Loading...' : 'Load more'}
          </Button>
        ) : null}
      </SelectContent>
    </Select>
  );
}
