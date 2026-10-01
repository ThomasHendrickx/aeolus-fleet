import type { ShipId } from '@aeolus-fleet/common';
import { cva, type VariantProps } from 'class-variance-authority';
import Link from 'next/link';

import { classNames } from '../../lib/class-names';

/** The id suffix shows this many of the id's last characters. */
const SUFFIX_LENGTH = 4;

const nameVariants = cva('min-w-0 truncate font-sans font-medium', {
  variants: {
    size: {
      body: 'text-body text-foreground',
      meta: 'text-meta text-muted-foreground',
      title: 'text-title font-semibold tracking-tight text-foreground max-sm:text-title-touch',
    },
  },
  defaultVariants: { size: 'body' },
});

type ShipNameProps = VariantProps<typeof nameVariants> & {
  name: string;
  shipId: ShipId;
  /** Where a name may be ambiguous over time: timelines, delivery history, retired ships. Never for argo. */
  isSuffixShown?: boolean;
  /** argo as a party reads "argo (you)". */
  isOperator?: boolean;
  /** The ship's page; the name is the link, never the whole row. */
  href?: string;
  className?: string;
};

/**
 * A ship name as a handle (docs/design/png/ShipName.png): sans at weight 500,
 * truncated with the full name in title, with the 4-character id suffix in mono
 * where the name may be ambiguous.
 */
export function ShipName({
  name,
  shipId,
  size,
  isSuffixShown = false,
  isOperator = false,
  href,
  className,
}: ShipNameProps) {
  const label = href ? (
    <Link
      href={href}
      className={classNames(
        nameVariants({ size }),
        'rounded-xs underline-offset-3 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
      )}
      title={name}
    >
      {name}
    </Link>
  ) : (
    <span className={nameVariants({ size })} title={name}>
      {name}
    </span>
  );
  return (
    <span data-slot="ship-name" className={classNames('inline-flex min-w-0 items-baseline gap-1.5', className)}>
      {label}
      {isOperator ? <span className="shrink-0 font-normal text-muted-foreground">(you)</span> : null}
      {isSuffixShown && !isOperator ? (
        <span className="shrink-0 font-mono text-id text-muted-foreground uppercase">
          <span aria-hidden>· </span>
          {shipId.slice(-SUFFIX_LENGTH)}
        </span>
      ) : null}
    </span>
  );
}
