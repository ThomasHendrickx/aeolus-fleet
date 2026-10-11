'use client';

import { Radio as RadioPrimitive } from '@base-ui/react/radio';
import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group';

import { classNames } from '../../lib/class-names';

/**
 * shadcn RadioGroup on Base UI: one choice of a short list shown in full, such
 * as a question's options. Checked fills with --primary. Each item's label
 * sits beside it, outside this atom.
 */
export function RadioGroup<Value>({ className, ...props }: RadioGroupPrimitive.Props<Value>) {
  return <RadioGroupPrimitive data-slot="radio-group" className={classNames('flex flex-col gap-2', className)} {...props} />;
}

export function RadioGroupItem({ className, ...props }: RadioPrimitive.Root.Props) {
  return (
    <RadioPrimitive.Root
      data-slot="radio-group-item"
      className={classNames(
        'inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-input bg-background transition-colors duration-(--duration-fast) outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-checked:border-primary data-disabled:opacity-45',
        className,
      )}
      {...props}
    >
      <RadioPrimitive.Indicator data-slot="radio-group-indicator" className="size-2 rounded-full bg-primary" />
    </RadioPrimitive.Root>
  );
}
