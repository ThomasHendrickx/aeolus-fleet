'use client';

import type { ShipDetail } from '@aeolus-fleet/common';
import { useState } from 'react';

import { showToast } from '@aeolus-fleet/ui';
import { lazyDialog } from '../../../lib/lazy-dialog';
import { useShipOwner } from '../hooks/use-ship-owner';
import { ShipOwner } from '../ui/molecules/ship-owner';

// The dialog loads when first opened, not with the page.
const ChangeOwnerDialog = lazyDialog(() => import('../ui/organisms/change-owner-dialog').then((module) => module.ChangeOwnerDialog), (props) => props.isOpen);

/**
 * A ship's owner on its page, with Change owner where the session may
 * (docs/design/ship-owners, "The Owner control on the ship page"). Done
 * closes the dialog with a toast, and the timeline reads "Owner changed by
 * argo"; a refusal keeps the dialog open with the fleet's reason. Nothing
 * for argo and the viewer, which no ship owns.
 */
export function ShipPageOwner({ ship }: { ship: ShipDetail }) {
  const [isOpen, setIsOpen] = useState(false);
  const { owner, canChange, choices, change } = useShipOwner(ship, isOpen);
  if (owner === undefined) {
    return null;
  }
  const open = () => {
    change.reset();
    setIsOpen(true);
  };

  return (
    <>
      <ShipOwner owner={owner} {...(canChange ? { onChange: open } : {})} />
      {owner.kind === 'ship' && canChange ? (
        <ChangeOwnerDialog
          shipName={ship.name}
          currentOwner={{ id: owner.id, name: owner.name ?? owner.id }}
          personShips={choices.personShips}
          argo={choices.argo}
          onQueryChange={choices.onQueryChange}
          {...(choices.readFailure === undefined ? {} : { readFailure: choices.readFailure })}
          isOpen={isOpen}
          onOpenChange={setIsOpen}
          isPending={change.isPending}
          {...(change.error === null ? {} : { error: change.error.message })}
          onSubmit={(ownerShipId) => {
            const picked = ownerShipId === choices.argo?.id ? choices.argo.name : (choices.personShips?.find((each) => each.id === ownerShipId)?.name ?? ownerShipId);
            change.mutate(
              { shipId: ship.id, ownerShipId },
              {
                onSuccess: () => {
                  setIsOpen(false);
                  showToast({ title: `Owner changed: ${picked} owns ${ship.name} now.`, tone: 'success' });
                },
              },
            );
          }}
        />
      ) : null}
    </>
  );
}
