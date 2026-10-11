'use client';

import { CircleDashed, FileKey, KeyRound, Undo2 } from 'lucide-react';

import { inFlightLine } from '../../../lib/ship-dialogs';
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../../components/atoms/alert-dialog';
import { Button } from '../../../components/atoms/button';
import { dialogSurface } from '../../../components/atoms/dialog-surface';
import { ConsequenceList, type Consequence } from '../../../components/molecules/consequence-list';
import { InlineError } from '../../../components/molecules/inline-error';

interface ReleaseDialogProps {
  shipName: string;
  /** Where the session crewing it runs, such as "hetzner-1"; the sentence names it when known. */
  sessionLocation?: string | null;
  /** What the crew holds in flight: what returns to pending. */
  inFlightCount: number;
  /** Release frees the ship; recrew also hands out a new starting prompt in the same step. */
  mode?: 'release' | 'recrew';
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  isPending: boolean;
  /** Why the last try failed; the dialog stays open and nothing changed. */
  error?: string;
  onConfirm: () => void;
}

const WORDS = {
  release: {
    title: 'Release',
    action: 'Release ship',
    busy: 'Releasing',
    failed: 'Couldn’t release the ship',
    testId: 'release-dialog',
  },
  recrew: {
    title: 'Re-crew',
    action: 'Re-crew ship',
    busy: 'Re-crewing',
    failed: 'Couldn’t re-crew the ship',
    testId: 'recrew-dialog',
  },
} as const;

function consequencesOf(props: Pick<ReleaseDialogProps, 'shipName' | 'inFlightCount' | 'mode'>): Consequence[] {
  const { shipName, inFlightCount, mode = 'release' } = props;
  return [
    { icon: KeyRound, text: 'Its secret and crew token stop working, so that session cannot come back.' },
    { icon: Undo2, text: inFlightLine(inFlightCount) },
    mode === 'release'
      ? { icon: CircleDashed, text: `${shipName} shows as Awaiting crew until you get a new starting prompt.` }
      : { icon: FileKey, text: 'A new starting prompt and its crew lines are shown once, for the new crew.' },
  ];
}

/**
 * Release or re-crew a crewed ship (docs/design/png/ReleaseDialog.png): a
 * normal confirm, since a new starting prompt crews the ship again. It lists
 * exactly what happens to the session, the secret and the in-flight
 * deliveries. Primary, not destructive. Re-crew is the same release with a new
 * starting prompt after it, in one step, so it shares this dialog (`mode`).
 * Desktop: a dialog; phone: a bottom sheet.
 */
export function ReleaseDialog(props: ReleaseDialogProps) {
  const { shipName, sessionLocation, mode = 'release', isOpen, onOpenChange, isPending, error, onConfirm } = props;
  const words = WORDS[mode];
  const who = sessionLocation ? `The session on ${sessionLocation}` : 'The session crewing it';

  return (
    <AlertDialog
      open={isOpen}
      onOpenChange={(isNowOpen) => {
        if (!isPending) {
          onOpenChange(isNowOpen);
        }
      }}
    >
      <AlertDialogContent data-testid={words.testId} className={dialogSurface.phoneSheet}>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {words.title} {shipName}?
          </AlertDialogTitle>
          <AlertDialogDescription>{who} loses this ship now.</AlertDialogDescription>
        </AlertDialogHeader>
        <ConsequenceList consequences={consequencesOf(props)} />
        {error === undefined ? null : (
          <InlineError title={words.failed} description={`${error} Nothing changed; the session still holds the ship.`} />
        )}
        <AlertDialogFooter>
          <AlertDialogClose render={<Button disabled={isPending} />}>Cancel</AlertDialogClose>
          <Button variant="primary" isLoading={isPending} onClick={onConfirm}>
            {isPending ? words.busy : words.action}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
