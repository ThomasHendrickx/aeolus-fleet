'use client';

import type { ListedShip } from '@aeolus-fleet/common';
import { useState } from 'react';

import { useGetStartingPrompt, useRecrewShip, useReleaseShip, useRetireShip } from '../../lib/fleet';
import { useShip } from '../../lib/ship';
import { isUnclaimedPromptOut } from '../../lib/starting-prompt';
import { Button } from '../atoms/button';
import { ReleaseDialog } from './release-dialog';
import { RetireDialog } from './retire-dialog';
import { StartingPromptDialog, type StartingPromptDialogState } from './starting-prompt-dialog';

type OpenDialog = 'release' | 'recrew' | 'retire' | 'prompt' | undefined;

/** Where a crewed ship's session runs, as the release dialog names it. */
function sessionLocationOf(ship: ListedShip): string | null {
  if (ship.location === null) {
    return null;
  }
  return ship.location.description ?? ship.location.kind.toLowerCase();
}

/**
 * A ship's actions, in a fleet row or on its page, each behind its designed
 * dialog (docs/design/conventions.md, "Confirm"). A ship awaiting crew offers
 * Get starting prompt and Retire; a crewed ship Re-crew, Release and Retire;
 * argo and retired ships none. A dialog reads the ship's counts first and
 * opens once it has them, so its numbers are exact and a retire never skips
 * the typed confirm because the open deliveries were not known yet. A new or re-crewed prompt shows once, in the
 * StartingPromptDialog.
 */
export function ShipActions({ ship }: { ship: ListedShip }) {
  const [dialog, setDialog] = useState<OpenDialog>();
  const getStartingPrompt = useGetStartingPrompt();
  const releaseShip = useReleaseShip();
  const retireShip = useRetireShip();
  const recrewShip = useRecrewShip();
  const counted = useShip(dialog === 'release' || dialog === 'recrew' || dialog === 'retire' ? ship.id : undefined);

  if (ship.kind === 'operator' || ship.status === 'retired') {
    return null;
  }

  const close = () => {
    setDialog(undefined);
  };
  const issued = getStartingPrompt.data ?? recrewShip.data;
  const promptState: StartingPromptDialogState = issued
    ? 'shown'
    : getStartingPrompt.isPending || recrewShip.isPending
      ? 'issuing'
      : getStartingPrompt.isError
        ? 'error'
        : 'confirm';

  const issuePrompt = () => {
    recrewShip.reset();
    getStartingPrompt.mutate({ shipId: ship.id });
  };
  const requestPrompt = () => {
    getStartingPrompt.reset();
    recrewShip.reset();
    setDialog('prompt');
    if (!isUnclaimedPromptOut(ship)) {
      getStartingPrompt.mutate({ shipId: ship.id });
    }
  };
  const open = (next: Exclude<OpenDialog, 'prompt' | undefined>) => () => {
    releaseShip.reset();
    retireShip.reset();
    recrewShip.reset();
    setDialog(next);
  };

  return (
    <div className="flex flex-wrap items-center justify-end gap-2 max-sm:justify-start">
      {ship.status === 'awaitingCrew' ? (
        <Button size="xs" data-testid="fleet-ship-prompt" onClick={requestPrompt}>
          Get starting prompt
        </Button>
      ) : (
        <>
          <Button size="xs" data-testid="fleet-ship-recrew" onClick={open('recrew')}>
            Re-crew
          </Button>
          <Button size="xs" data-testid="fleet-ship-release" onClick={open('release')}>
            Release
          </Button>
        </>
      )}
      <Button size="xs" variant="ghost" data-testid="fleet-ship-retire" onClick={open('retire')}>
        Retire
      </Button>

      <ReleaseDialog
        shipName={ship.name}
        sessionLocation={sessionLocationOf(ship)}
        inFlightCount={counted.data?.inFlightDeliveries ?? 0}
        mode={dialog === 'recrew' ? 'recrew' : 'release'}
        isOpen={(dialog === 'release' || dialog === 'recrew') && counted.data !== undefined}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            close();
          }
        }}
        isPending={releaseShip.isPending || recrewShip.isPending}
        error={(dialog === 'recrew' ? recrewShip.error : releaseShip.error)?.message}
        onConfirm={() => {
          if (dialog === 'recrew') {
            recrewShip.mutate({ shipId: ship.id }, { onSuccess: () => { setDialog('prompt'); } });
          } else {
            releaseShip.mutate({ shipId: ship.id }, { onSuccess: close });
          }
        }}
      />
      <RetireDialog
        shipName={ship.name}
        openDeliveries={counted.data?.openDeliveries ?? 0}
        isCrewed={ship.status === 'crewed'}
        isOpen={dialog === 'retire' && counted.data !== undefined}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            close();
          }
        }}
        isPending={retireShip.isPending}
        error={retireShip.error?.message}
        onConfirm={() => {
          retireShip.mutate({ shipId: ship.id }, { onSuccess: close });
        }}
      />
      <StartingPromptDialog
        shipName={ship.name}
        state={promptState}
        prompt={issued?.prompt}
        crewLine={issued?.crewLine}
        replacesUnclaimed={
          isUnclaimedPromptOut(ship) && ship.startingPrompt ? { issuedAt: ship.startingPrompt.issuedAt } : undefined
        }
        error={getStartingPrompt.error?.message}
        isOpen={dialog === 'prompt'}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            getStartingPrompt.reset();
            recrewShip.reset();
            close();
          }
        }}
        onConfirm={issuePrompt}
      />
    </div>
  );
}
