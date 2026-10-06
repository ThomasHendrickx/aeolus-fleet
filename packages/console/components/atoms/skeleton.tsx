import type { ComponentProps } from 'react';

import { classNames } from '../../lib/class-names';

/**
 * shadcn Skeleton, themed to docs/design/png/Skeleton.png: --secondary fill,
 * --radius-sm, a 1.8 s pulse that stays still under reduced motion. The size
 * comes from className, in the shape of the content it stands for.
 */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={classNames(
        'animate-pulse rounded-sm bg-secondary [animation-duration:var(--duration-pulse)] motion-reduce:animate-none',
        className,
      )}
      {...props}
    />
  );
}
