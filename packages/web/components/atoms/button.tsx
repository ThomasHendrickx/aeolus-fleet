import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';
import { LoaderCircle } from 'lucide-react';
import type { ReactNode } from 'react';

import { classNames } from '../../lib/class-names';

/**
 * shadcn Button on Base UI, themed to docs/design/png/Button.png: primary
 * (shadcn default), secondary (shadcn outline), ghost and destructive, in four
 * sizes. Icons sit spacing-2 from the label.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-transparent font-medium whitespace-nowrap transition-[background-color,border-color,opacity] duration-(--duration-fast) select-none data-disabled:pointer-events-none data-disabled:not-data-loading:opacity-45 data-loading:cursor-progress [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-(--size-icon)",
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary-hover',
        secondary: 'border-input bg-card text-foreground shadow-sm hover:bg-accent aria-expanded:bg-accent',
        ghost: 'bg-transparent text-foreground hover:bg-accent aria-expanded:bg-accent',
        destructive: 'bg-destructive text-destructive-foreground hover:opacity-90',
      },
      size: {
        xs: 'h-(--size-control-xs) gap-1.5 px-2.5 text-meta',
        sm: 'h-(--size-control-sm) px-3 text-meta',
        md: 'h-(--size-control) px-3.5 text-body',
        touch: 'h-(--size-control-touch) rounded-lg px-4 text-body-touch',
      },
      isIconOnly: {
        true: 'px-0',
        false: '',
      },
    },
    compoundVariants: [
      { isIconOnly: true, size: 'xs', className: 'w-(--size-control-xs)' },
      { isIconOnly: true, size: 'sm', className: 'w-(--size-control-sm)' },
      { isIconOnly: true, size: 'md', className: 'w-(--size-control)' },
      { isIconOnly: true, size: 'touch', className: 'w-(--size-control-touch)' },
    ],
    defaultVariants: {
      variant: 'secondary',
      size: 'md',
      isIconOnly: false,
    },
  },
);

type ButtonProps = ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    /** A Lucide icon before the label. */
    icon?: ReactNode;
    /** Keeps the label, puts a spinner in place of the icon and blocks input, without dimming. */
    isLoading?: boolean;
  };

/** A link styled as a button: pass `render={<a href="..." />}` and `nativeButton={false}` (Base UI's asChild). */
export function Button({
  className,
  variant,
  size,
  isIconOnly,
  icon,
  isLoading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <ButtonPrimitive
      data-slot="button"
      data-loading={isLoading ? '' : undefined}
      aria-busy={isLoading || undefined}
      disabled={disabled === true || isLoading}
      // A busy button keeps its focus, so a keyboard user does not lose their place.
      focusableWhenDisabled={isLoading}
      className={classNames(buttonVariants({ variant, size, isIconOnly }), className)}
      {...props}
    >
      {isLoading ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : icon}
      {children}
    </ButtonPrimitive>
  );
}
