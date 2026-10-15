'use client';

import { Select, SelectContent, SelectItem, SelectTrigger } from '../../../components/atoms/select';
import { classNames } from '../../../lib/class-names';
import { ALL, pickedAfter, pickedSummary, shownPicks } from '../lib/filter-pick';

export interface FilterSelectProps {
  /** The filter's name, muted before what is picked: "Kind". */
  label: string;
  /** Every value it can pick, with its word, in the order listed; All comes first by itself. */
  items: Readonly<Record<string, string>>;
  /** The values picked, in the order picked; none is no filter. */
  picked: readonly string[];
  onPickedChange: (picked: string[]) => void;
  size?: 'sm' | 'touch';
  /** Set on each value's item and on the one value named in the trigger, such as `font-mono` for ship types. */
  valueClassName?: string;
  testId?: string;
}

/**
 * An overview filter that picks several values (#815): the themed Select
 * (docs/design/png/Select.png), open until dismissed, each value checked
 * when picked, All checked while nothing is. The trigger names the one value
 * picked or counts several, in the pill the Labels button counts with.
 */
export function FilterSelect({ label, items, picked, onPickedChange, size = 'sm', valueClassName, testId }: FilterSelectProps) {
  const summary = pickedSummary(picked, items);
  return (
    <Select
      multiple
      value={shownPicks(picked)}
      onValueChange={(next) => {
        onPickedChange(pickedAfter(picked, next));
      }}
    >
      <SelectTrigger size={size} aria-label={label} data-testid={testId}>
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
      <SelectContent>
        <SelectItem value={ALL}>All</SelectItem>
        {Object.entries(items).map(([value, word]) => (
          <SelectItem key={value} value={value} className={valueClassName}>
            {word}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
