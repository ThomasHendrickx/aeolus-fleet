import type { ComponentProps } from 'react';

import { classNames } from '../../lib/class-names';

/**
 * shadcn Label: the visible name above a field (docs/design/png/Input.png),
 * body size at weight 500. It always names its field by id.
 */
export function Label({ className, htmlFor, ...props }: ComponentProps<'label'> & { htmlFor: string }) {
  return (
    <label
      data-slot="label"
      htmlFor={htmlFor}
      className={classNames('text-body font-medium text-foreground select-none', className)}
      {...props}
    />
  );
}
