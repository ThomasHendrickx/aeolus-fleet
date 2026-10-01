import { Input as InputPrimitive } from '@base-ui/react/input';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps, ReactNode } from 'react';

import { classNames } from '../../lib/class-names';

/**
 * shadcn Input on Base UI, themed to docs/design/png/Input.png: 36 px on
 * desktop, 44 px with 16 px text on phone. Names, types and ids use the mono
 * family. aria-invalid draws the invalid ring; the error itself sits under the
 * field, outside this atom.
 */
const inputVariants = cva(
  'w-full min-w-0 rounded-md border border-input bg-card text-foreground shadow-sm transition-[border-color,box-shadow] duration-(--duration-fast) outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/22 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/16 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50 disabled:shadow-none',
  {
    variants: {
      size: {
        md: 'h-(--size-control) px-3 text-body',
        touch: 'h-(--size-control-touch) rounded-lg px-3 text-input-touch',
      },
      isMono: {
        true: 'font-mono',
        false: '',
      },
    },
    defaultVariants: { size: 'md', isMono: false },
  },
);

type InputProps = Omit<ComponentProps<'input'>, 'size'> &
  VariantProps<typeof inputVariants> & {
    /** A decorative icon inside the field, before the text. */
    leadingIcon?: ReactNode;
    /** A status icon inside the field, after the text: valid or invalid. */
    trailingIcon?: ReactNode;
  };

export function Input({ className, size, isMono, leadingIcon, trailingIcon, ...props }: InputProps) {
  const input = (
    <InputPrimitive
      data-slot="input"
      className={classNames(
        inputVariants({ size, isMono }),
        leadingIcon ? 'pl-9' : undefined,
        trailingIcon ? 'pr-9' : undefined,
        className,
      )}
      {...props}
    />
  );
  if (!leadingIcon && !trailingIcon) {
    return input;
  }
  return (
    <div className="relative w-full [&_svg]:size-(--size-icon)">
      {leadingIcon ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground"
        >
          {leadingIcon}
        </span>
      ) : null}
      {input}
      {trailingIcon ? (
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
          {trailingIcon}
        </span>
      ) : null}
    </div>
  );
}
