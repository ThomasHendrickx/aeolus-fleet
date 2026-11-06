'use client';

import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox';
import { Check } from 'lucide-react';

import { classNames } from '../class-names.js';

/**
 * shadcn Checkbox on Base UI, themed to docs/design/png/Checkbox.png: one
 * choice among several in a form. Checked fills with --primary. The label sits
 * to the right, outside this atom. A single instant setting uses Switch.
 */
export function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={classNames(
        'peer inline-flex size-4 shrink-0 items-center justify-center rounded-sm border border-input bg-card text-primary-foreground transition-colors duration-(--duration-fast) outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-checked:border-primary data-checked:bg-primary data-disabled:opacity-45',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="flex items-center justify-center">
        <Check aria-hidden="true" className="size-3" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
