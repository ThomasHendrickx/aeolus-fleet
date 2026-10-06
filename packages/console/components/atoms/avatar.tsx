'use client';

import { Avatar as AvatarPrimitive } from '@base-ui/react/avatar';
import { cva, type VariantProps } from 'class-variance-authority';
import { Ship, UserRound } from 'lucide-react';

import { classNames } from '../../lib/class-names';

/**
 * shadcn Avatar on Base UI, used as a mark (docs/design/png/Avatar.png): the
 * app, the operator's account, a ship (two mono letters from its name), argo
 * (the operator mark) and a retired ship (dashed frame). Decorative: the name
 * is always written next to it, so it is hidden from assistive technology.
 */
const avatarVariants = cva(
  'inline-flex shrink-0 items-center justify-center overflow-hidden font-semibold uppercase select-none',
  {
    variants: {
      kind: {
        app: 'rounded-sm bg-primary text-primary-foreground',
        account: 'rounded-full bg-secondary font-sans text-foreground',
        ship: 'rounded-sm bg-secondary font-mono text-foreground',
        argo: 'rounded-sm bg-highlight text-primary',
        retired: 'rounded-sm border border-dashed border-input font-mono font-medium text-muted-foreground',
      },
      size: {
        20: 'size-5 text-micro [&_svg]:size-3',
        28: 'size-7 text-micro [&_svg]:size-(--size-icon-sm)',
        36: 'size-9 text-caption [&_svg]:size-(--size-icon)',
      },
    },
    defaultVariants: { kind: 'ship', size: 28 },
  },
);

type AvatarKind = NonNullable<VariantProps<typeof avatarVariants>['kind']>;

const LETTERS = 2;

function markOf(kind: AvatarKind, name: string) {
  if (kind === 'app') {
    return <Ship aria-hidden />;
  }
  if (kind === 'argo') {
    return <UserRound aria-hidden />;
  }
  return name.replaceAll('-', '').slice(0, LETTERS);
}

export function Avatar({
  kind = 'ship',
  size,
  name = '',
  className,
}: VariantProps<typeof avatarVariants> & { name?: string; className?: string }) {
  const resolvedKind = kind ?? 'ship';
  return (
    <AvatarPrimitive.Root
      aria-hidden
      data-slot="avatar"
      className={classNames(avatarVariants({ kind, size }), className)}
    >
      <AvatarPrimitive.Fallback>{markOf(resolvedKind, name)}</AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}
