'use client';

import type { ShipDetail } from '@aeolus-fleet/common';
import { isInReadReach, RECORD_PAGE_SIZE_DEFAULT } from '@aeolus-fleet/common/rules';
import { keepPreviousData, skipToken, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { useAccess } from '../../../lib/access';
import { useSetOwner } from '../../../lib/fleet';
import { useTRPC } from '../../../lib/trpc';
import type { OwnerChoice } from '../ui/organisms/change-owner-dialog';
import type { ShipOwnerView } from '../ui/molecules/ship-owner';

export interface ShipOwnerControl {
  /** Who owns the ship; undefined for argo and the viewer, which no ship owns. */
  owner: ShipOwnerView | undefined;
  /** Whether Change owner is offered: the session holds fleet:owner, and the ship is active and no person's ship. */
  canChange: boolean;
  /** What the dialog offers, read only while it is open. */
  choices: {
    personShips: readonly OwnerChoice[] | undefined;
    argo: (OwnerChoice & { isYou: boolean }) | undefined;
    onQueryChange: (query: string) => void;
    readFailure?: { message: string; onRetry: () => void };
  };
  change: ReturnType<typeof useSetOwner>;
}

/**
 * A ship's owner on its page (decision 0045, docs/design/ship-owners): its
 * owner's ship by name, and, while Change owner is open, the fleet's active
 * person ships whose names hold what was typed and argo, the fallback. A
 * person ship owns itself and is never changed; a retired ship keeps the
 * owner it had.
 */
export function useShipOwner(ship: ShipDetail, isDialogOpen: boolean): ShipOwnerControl {
  const trpc = useTRPC();
  const access = useAccess();
  const change = useSetOwner();
  const [query, setQuery] = useState('');
  const ownerShipId = ship.ownerShipId;
  const isItself = ownerShipId === ship.id;
  const account = useQuery(trpc.console.account.queryOptions());
  const owner = useQuery(trpc.fleet.ship.queryOptions(ownerShipId === null || isItself ? skipToken : { shipId: ownerShipId }));
  const canChange = access.canChangeOwner && ship.status !== 'retired' && ship.kind !== 'person' && ownerShipId !== null;
  const isReading = isDialogOpen && canChange;
  const nameQuery = query.trim();
  const personShips = useQuery(
    trpc.fleet.list.queryOptions(
      { shipKind: ['person'], limit: RECORD_PAGE_SIZE_DEFAULT, ...(nameQuery === '' ? {} : { nameQuery }) },
      { enabled: isReading, placeholderData: keepPreviousData },
    ),
  );
  // argo is read with Change owner offered, so the dialog opens with it in the list.
  const argo = useQuery(trpc.fleet.list.queryOptions({ shipKind: ['operator'], limit: 1 }, { enabled: canChange }));
  const isArgoSession = account.data?.kind === 'operator';
  const argoShip = argo.data?.items[0];
  const failed = personShips.isError ? personShips : argo.isError ? argo : undefined;

  return {
    owner:
      ownerShipId === null
        ? undefined
        : isItself
          ? { kind: 'itself' }
          : { kind: 'ship', id: ownerShipId, name: owner.data?.name, isYou: isArgoSession && owner.data !== undefined && isInReadReach(owner.data) && owner.data.kind === 'operator' },
    canChange,
    choices: {
      personShips: personShips.data?.items.filter((each) => each.status !== 'retired').map((each) => ({ id: each.id, name: each.name })),
      argo: argoShip === undefined ? undefined : { id: argoShip.id, name: argoShip.name, isYou: isArgoSession },
      onQueryChange: setQuery,
      ...(failed === undefined
        ? {}
        : {
            readFailure: {
              message: failed.error.message,
              onRetry: () => {
                void personShips.refetch();
                void argo.refetch();
              },
            },
          }),
    },
    change,
  };
}
