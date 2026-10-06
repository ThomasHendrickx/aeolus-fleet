import type { ComponentProps } from 'react';

import { classNames } from '../../lib/class-names';

/**
 * shadcn Kbd (docs/design/png/Kbd.png): a key or shortcut, beside the action
 * it hints at. Desktop only: hidden on phone, and never the only way to learn
 * an action.
 */
export function Kbd({ className, ...props }: ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot="kbd"
      className={classNames(
        'inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-xs border border-border bg-muted px-1.25 font-sans text-micro font-medium text-muted-foreground max-sm:hidden',
        className,
      )}
      {...props}
    />
  );
}
