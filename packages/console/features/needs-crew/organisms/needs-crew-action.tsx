'use client';

import type { ListedShip } from '@aeolus-fleet/common';
import { Power } from 'lucide-react';
import { useState } from 'react';

import { lazyDialog } from '../../../lib/lazy-dialog';
import { useAccess } from '../../../lib/access';
import { crewRequestStage } from '../../../lib/crew-request';
import { useRemoveCrewRequest } from '../../../lib/fleet';
import { useShip } from '../../../lib/ship';
import { Button } from '../../../components/atoms/button';
import { ShipActions } from '../../ship-actions/organisms/ship-actions';

// Dialogs load when first opened, not with the page.
const CrewReleaseDialog = lazyDialog(() => import('../../../components/organisms/crew-release-dialog').then((module) => module.CrewReleaseDialog), (props) => props.isOpen);

/**
 * A Needs crew row's next step (canvas CrNeedsOff, CrNeedsOn): without the
 * trierarch plugin, Get starting prompt, to crew the ship by hand; with it,
 * Release… on a crashed request, which its trierarch carries out. Nothing
 * else: the rest waits on the plugin, and the ship's page holds every action.
 */
export function NeedsCrewAction({ ship, hasTrierarchs }: { ship: ListedShip; hasTrierarchs: boolean }) {
  const access = useAccess();
  const removeCrewRequest = useRemoveCrewRequest();
  const [isReleasing, setIsReleasing] = useState(false);
  // The in-flight count, read once the confirm opens, so the dialog says what returns to pending.
  const detail = useShip(isReleasing ? ship.id : undefined);
  const stage = crewRequestStage(ship);
  if (!hasTrierarchs) {
    return <ShipActions ship={ship} layout="next" />;
  }
  if (!access.canManage || stage.kind !== 'assigned' || stage.status !== 'crashed') {
    return null;
  }
  return (
    <>
      <Button
        size="xs"
        icon={<Power />}
        data-testid="needs-crew-release"
        onClick={() => {
          removeCrewRequest.reset();
          setIsReleasing(true);
        }}
      >
        Release…
      </Button>
      <CrewReleaseDialog
        shipName={ship.name}
        stage={stage}
        inFlightCount={detail.data?.inFlightDeliveries ?? 0}
        isOpen={isReleasing && detail.data !== undefined}
        onOpenChange={setIsReleasing}
        isPending={removeCrewRequest.isPending}
        error={removeCrewRequest.error === null ? undefined : `${removeCrewRequest.error.message} Nothing changed.`}
        onConfirm={() => {
          removeCrewRequest.mutate(
            { shipId: ship.id },
            {
              onSuccess: () => {
                setIsReleasing(false);
              },
            },
          );
        }}
      />
    </>
  );
}
