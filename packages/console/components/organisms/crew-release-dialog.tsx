'use client';

import { CircleDashed, KeyRound, ListX, Power, Undo2 } from 'lucide-react';

import type { CrewRequestStage } from '../../lib/crew-request';
import { inFlightLine } from '../../lib/ship-dialogs';
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../atoms/alert-dialog';
import { Button } from '../atoms/button';
import { dialogSurface } from '../atoms/dialog-surface';
import { ConsequenceList, type Consequence } from '../molecules/consequence-list';
import { InlineError } from '../molecules/inline-error';

/** The request being released: crewed by hand, or assigned to a trierarch. */
type ReleasedStage = Extract<CrewRequestStage, { kind: 'crewedByHand' | 'assigned' }>;

interface CrewReleaseDialogProps {
  shipName: string;
  stage: ReleasedStage;
  /** Where the session crewing it by hand runs, such as "MacBook"; the sentence names it when known. */
  sessionLocation?: string | null;
  /** What the crew holds in flight: what returns to pending. */
  inFlightCount: number;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  isPending: boolean;
  /** Why the last try failed; the dialog stays open. */
  error?: string;
  onConfirm: () => void;
}

function consequencesOf(props: Pick<CrewReleaseDialogProps, 'shipName' | 'stage' | 'sessionLocation' | 'inFlightCount'>): Consequence[] {
  const { shipName, stage, sessionLocation, inFlightCount } = props;
  const inFlight = { icon: Undo2, text: inFlightLine(inFlightCount) };
  if (stage.kind === 'crewedByHand') {
    const session = sessionLocation ? `the session on ${sessionLocation}` : 'the session crewing it';
    return [
      { icon: ListX, text: 'Removes its crew request from Needs crew.' },
      { icon: KeyRound, text: `The lease ends: ${session} loses this ship and its secret stops working.` },
      inFlight,
    ];
  }
  return [
    { icon: ListX, text: 'Removes its crew request, so nothing crews it again.' },
    {
      icon: Power,
      text: `${stage.trierarch.name} stops the session and cleans up: the worktree goes if it has no uncommitted changes; with changes it is kept.`,
    },
    { icon: CircleDashed, text: `The lease ends. ${shipName} shows Awaiting crew.` },
    inFlight,
  ];
}

/**
 * Release a ship from its crew request card (canvas CrRelease and
 * CrReleaseOff): a normal confirm. An assigned request is released by its
 * trierarch, which cleans up and confirms; a ship crewed by hand loses its
 * session now, which stays the operator's to stop. Desktop: a dialog; phone: a
 * bottom sheet.
 */
export function CrewReleaseDialog(props: CrewReleaseDialogProps) {
  const { shipName, stage, isOpen, onOpenChange, isPending, error, onConfirm } = props;
  const description =
    stage.kind === 'crewedByHand'
      ? 'It was crewed by hand, so stopping that session is up to you.'
      : `Until ${stage.trierarch.name} confirms its clean-up, the request shows Releasing.`;

  return (
    <AlertDialog
      open={isOpen}
      onOpenChange={(isNowOpen) => {
        if (!isPending) {
          onOpenChange(isNowOpen);
        }
      }}
    >
      <AlertDialogContent data-testid="crew-release-dialog" className={dialogSurface.phoneSheet}>
        <AlertDialogHeader>
          <AlertDialogTitle>Release {shipName}?</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <ConsequenceList consequences={consequencesOf(props)} />
        {error === undefined ? null : <InlineError title="Couldn’t release the ship" description={error} />}
        <AlertDialogFooter>
          <AlertDialogClose render={<Button disabled={isPending} />}>Cancel</AlertDialogClose>
          <Button variant="primary" icon={<Power />} isLoading={isPending} onClick={onConfirm} data-testid="crew-release-confirm">
            {isPending ? 'Releasing' : 'Release'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
