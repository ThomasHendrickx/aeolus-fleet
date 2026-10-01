'use client';

import { Switch as SwitchPrimitive } from '@base-ui/react/switch';

import { classNames } from '../../lib/class-names';

/**
 * shadcn Switch on Base UI, themed to docs/design/png/Switch.png: one instant
 * on or off setting, such as Show retired on the overview. On fills with
 * --primary. The label sits to the right, outside this atom.
 */
export function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={classNames(
        'peer inline-flex h-5 w-8.5 shrink-0 items-center rounded-full border border-transparent bg-input p-0.5 transition-colors duration-(--duration-fast) outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-checked:bg-primary data-disabled:cursor-not-allowed data-disabled:opacity-45',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4 rounded-full bg-card shadow-sm transition-transform duration-(--duration-fast) data-checked:translate-x-3.5"
      />
    </SwitchPrimitive.Root>
  );
}
