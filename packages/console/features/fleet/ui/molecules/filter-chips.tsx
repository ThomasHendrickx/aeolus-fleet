import type { ReactNode } from 'react';

import { classNames } from '@aeolus-fleet/ui';

export interface FilterChipsProps {
  /** The filter's name, over its chips and as the group's name: "State". */
  label: string;
  /** Every value it can pick, in the order listed, with what its chip shows. */
  items: readonly { value: string; content: ReactNode }[];
  /** The values picked, in the order picked; none is no filter. */
  picked: readonly string[];
  onPickedChange: (picked: string[]) => void;
  /** Set on each chip, such as `font-mono` for ship types and labels. */
  chipClassName?: string;
  testId?: string;
}

/**
 * One of the phone's filters in the overview's filter Sheet
 * (docs/design/fleet-overview, "the filter Sheet open"): a chip per value,
 * pressed while picked; several may be.
 */
export function FilterChips({ label, items, picked, onPickedChange, chipClassName, testId }: FilterChipsProps) {
  return (
    <div className="flex flex-col gap-2">
      <span aria-hidden className="text-meta text-muted-foreground">
        {label}
      </span>
      <div role="group" aria-label={label} data-testid={testId} className="flex flex-wrap gap-1.5">
        {items.map(({ value, content }) => {
          const isPicked = picked.includes(value);
          return (
            <button
              key={value}
              type="button"
              aria-pressed={isPicked}
              onClick={() => {
                onPickedChange(isPicked ? picked.filter((each) => each !== value) : [...picked, value]);
              }}
              className={classNames(
                'inline-flex h-10 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-body-touch font-medium text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-pressed:border-tone-active-border aria-pressed:bg-tone-active-bg [&_svg]:size-4',
                chipClassName,
              )}
            >
              {content}
            </button>
          );
        })}
      </div>
    </div>
  );
}
