import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { classNames } from '../../lib/class-names';

/**
 * shadcn Textarea, themed to docs/design/png/Textarea.png: mono 13 px for
 * payloads, sans for notes and replies. Fixed height from rows, no resize
 * handle; it scrolls inside. Phone text is 16 px.
 */
const textareaVariants = cva(
  'w-full min-w-0 resize-none rounded-md border border-input bg-card px-3 py-2 text-foreground shadow-sm transition-[border-color,box-shadow] duration-(--duration-fast) outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/22 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/16 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50 disabled:shadow-none',
  {
    variants: {
      size: {
        md: 'text-body',
        touch: 'rounded-lg text-input-touch',
      },
      isMono: {
        true: 'font-mono',
        false: '',
      },
    },
    // Payloads read at --text-code on desktop; phone keeps 16 px so the browser does not zoom.
    compoundVariants: [{ size: 'md', isMono: true, className: 'text-code' }],
    defaultVariants: { size: 'md', isMono: false },
  },
);

type TextareaProps = ComponentProps<'textarea'> & VariantProps<typeof textareaVariants>;

export function Textarea({ className, size, isMono, rows = 4, ...props }: TextareaProps) {
  return (
    <textarea
      data-slot="textarea"
      rows={rows}
      className={classNames(textareaVariants({ size, isMono }), className)}
      {...props}
    />
  );
}
