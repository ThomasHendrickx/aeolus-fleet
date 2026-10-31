'use client';

import { Tabs, TabsList, TabsTrigger } from '../../../../components/atoms/tabs';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  /** What the control chooses, for assistive technology: "Time range". */
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** The control's area, for `{testId}-{value}` on each option. */
  testId: string;
}

/**
 * One choice among a few, as the segmented Tabs show it (docs/design/png/Tabs.png):
 * the Usage page's time range, split and measure. A press shows at once; the
 * page keeps the choice in its URL.
 */
export function SegmentedControl<T extends string>({ label, options, value, onChange, testId }: SegmentedControlProps<T>) {
  return (
    <Tabs
      value={value}
      onValueChange={(next) => {
        const chosen = options.find((option) => option.value === next);
        if (chosen !== undefined) {
          onChange(chosen.value);
        }
      }}
    >
      <TabsList aria-label={label} data-testid={testId}>
        {options.map((option) => (
          <TabsTrigger key={option.value} value={option.value} data-testid={`${testId}-${option.value}`}>
            {option.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
