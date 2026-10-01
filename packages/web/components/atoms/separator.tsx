'use client';

import { Separator as SeparatorPrimitive } from '@base-ui/react/separator';

import { classNames } from '../../lib/class-names';

/**
 * shadcn Separator on Base UI: 1 px --border. Groups menu items and toolbar
 * clusters; sections of a page use spacing, not lines.
 */
export function Separator({ className, orientation = 'horizontal', ...props }: SeparatorPrimitive.Props) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      className={classNames(
        'shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-px data-[orientation=vertical]:self-stretch',
        className,
      )}
      {...props}
    />
  );
}
