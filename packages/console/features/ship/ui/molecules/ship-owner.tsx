import type { ShipId } from '@aeolus-fleet/common';
import { Pencil } from 'lucide-react';
import Link from 'next/link';

import { Button, Skeleton } from '@aeolus-fleet/ui';

/** Who owns the ship: a person ship owns itself; any other its owner's ship, named once read. */
export type ShipOwnerView = { kind: 'itself' } | { kind: 'ship'; id: ShipId; name: string | undefined; isYou: boolean };

interface ShipOwnerProps {
  owner: ShipOwnerView;
  /** Opens Change owner; no button without it (no fleet:owner, a retired ship, a person ship). */
  onChange?: () => void;
}

/**
 * The Owner row's value on the ship page (docs/design/ship-owners, "The
 * Owner control on the ship page"): the owner's ship, linked to its page,
 * "argo (you)" when argo owns it and the session is argo's; a person ship
 * "Owns itself". Change owner sits beside it (Q1), as Add label sits by the
 * labels.
 */
export function ShipOwner({ owner, onChange }: ShipOwnerProps) {
  if (owner.kind === 'itself') {
    return <span data-testid="ship-owner-name">Owns itself</span>;
  }
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5">
      {owner.name === undefined ? (
        <Skeleton className="h-5 w-24" />
      ) : (
        <Link href={`/ships/${owner.id}`} data-testid="ship-owner-name" className="font-medium text-foreground underline underline-offset-2">
          {owner.isYou ? `${owner.name} (you)` : owner.name}
        </Link>
      )}
      {onChange === undefined ? null : (
        <Button type="button" variant="ghost" size="sm" onClick={onChange} data-testid="ship-owner-change">
          <Pencil aria-hidden />
          Change owner
        </Button>
      )}
    </span>
  );
}
