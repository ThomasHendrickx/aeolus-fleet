'use client';

import type { ReactNode } from 'react';

import { Select, SelectContent, SelectItem, SelectTrigger } from '../../../../components/atoms/select';
import { classNames } from '@aeolus-fleet/ui';
import { ALL, pickedAfter, pickedSummary, shownPicks } from '../../services/filter-pick';

export interface FilterSelectProps {
  /** The filter's name, muted before what is picked: "State". */
  label: string;
  /** Every value it can pick, with its word, in the order listed; All comes first by itself. */
  items: Readonly<Record<string, string>>;
  /** The values picked, in the order picked; none is no filter. */
  picked: readonly string[];
  onPickedChange: (picked: string[]) => void;
  /** How many ships each value holds, and All, at the end of each row (docs/design/fleet-overview); none draws no counts. */
  counts?: { total: number; of: Readonly<Record<string, number>> };
  /** A value as its row shows it, such as a state's icon and word in its tone; its word without one. */
  renderItem?: (value: string, word: string) => ReactNode;
  size?: 'sm' | 'touch';
  /** Set on each value's item and on the one value named in the trigger, such as `font-mono` for ship types. */
  valueClassName?: string;
  /** Set on the trigger, such as the overview bar's control height. */
  className?: string;
  testId?: string;
}

function Count({ value }: { value: number | undefined }) {
  return value === undefined ? null : <span className="ml-auto pl-4 text-meta text-muted-foreground tabular-nums">{value}</span>;
}

/**
 * An overview filter that picks several values (#815): the themed Select
 * (docs/design/png/Select.png), open until dismissed, each value checked
 * when picked, All checked while nothing is. The trigger names the one value
 * picked or counts several, in the pill the Labels button counts with. With
 * counts, each row says how many ships it holds, its check at the start.
 */
export function FilterSelect({ label, items, picked, onPickedChange, counts, renderItem, size = 'sm', valueClassName, className, testId }: FilterSelectProps) {
  const summary = pickedSummary(picked, items);
  const indicator = counts === undefined ? 'end' : 'start';
  return (
    <Select
      multiple
      value={shownPicks(picked)}
      onValueChange={(next) => {
        onPickedChange(pickedAfter(picked, next));
      }}
    >
      <SelectTrigger size={size} aria-label={label} data-testid={testId} className={className}>
        <span className="flex items-center gap-1.5">
          <span className="text-muted-foreground">{label}</span>
          {summary.kind === 'several' ? (
            <span className="inline-flex size-5 items-center justify-center rounded-full bg-primary text-caption font-semibold text-primary-foreground tabular-nums">
              {summary.count}
              <span className="sr-only"> picked</span>
            </span>
          ) : (
            <span className={classNames('font-medium', summary.kind === 'one' ? valueClassName : undefined)}>{summary.kind === 'one' ? summary.word : 'All'}</span>
          )}
        </span>
      </SelectTrigger>
      <SelectContent className={counts === undefined ? undefined : 'min-w-55'}>
        <SelectItem value={ALL} indicator={indicator}>
          All
          <Count value={counts?.total} />
        </SelectItem>
        {counts === undefined ? null : <div role="separator" className="-mx-1 my-1 h-px bg-border" />}
        {Object.entries(items).map(([value, word]) => (
          <SelectItem key={value} value={value} className={valueClassName} indicator={indicator}>
            {renderItem === undefined ? word : renderItem(value, word)}
            <Count value={counts?.of[value]} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
