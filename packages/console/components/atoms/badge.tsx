import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import { cva, type VariantProps } from 'class-variance-authority';

import { classNames } from '../../lib/class-names';

/**
 * shadcn Badge, themed to docs/design/png/Badge.png. Neutral and outline for
 * facts, type chips in mono, the operator kind chip on --highlight, counts as
 * pills. Tone badges are StatusBadge, never built here by hand.
 */
const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1.5 border font-medium whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-(--size-icon-sm)',
  {
    variants: {
      variant: {
        secondary: 'h-5.5 rounded-sm border-transparent bg-secondary px-1.5 text-caption text-secondary-foreground',
        outline: 'h-5.5 rounded-sm border-border bg-transparent px-1.5 text-caption text-foreground',
        type: 'h-5.5 rounded-sm border-transparent bg-secondary px-1.5 font-mono text-id text-foreground',
        kind: 'h-5.5 rounded-sm border-transparent bg-highlight px-1.5 font-mono text-id text-primary',
        count:
          'h-5 min-w-5 rounded-full border-transparent bg-primary px-1.5 text-micro font-semibold text-primary-foreground tabular-nums',
        'count-neutral':
          'h-5 min-w-5 rounded-full border-transparent bg-secondary px-1.5 text-micro font-semibold text-foreground tabular-nums',
        'count-attention':
          'h-5 min-w-5 rounded-full border-tone-attention-border bg-tone-attention-bg px-1.5 text-micro font-semibold text-tone-attention-fg tabular-nums',
      },
    },
    defaultVariants: { variant: 'secondary' },
  },
);

type BadgeProps = useRender.ComponentProps<'span'> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, render, ...props }: BadgeProps) {
  return useRender({
    defaultTagName: 'span',
    props: mergeProps<'span'>({ className: classNames(badgeVariants({ variant }), className) }, props),
    render,
    state: { slot: 'badge', variant },
  });
}
