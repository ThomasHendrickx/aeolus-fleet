'use client';

import { CircleCheck, KeyRound, Tag, TriangleAlert, UserX, Users } from 'lucide-react';
import { useState } from 'react';

import { abandonedLine, isTypedMatch, retireButtonLabel } from '../../lib/ship-dialogs';
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
import { TypedConfirm } from '../molecules/typed-confirm';

interface RetireDialogProps {
  shipName: string;
  /** Its direct deliveries pending or in flight: what the retire abandons. */
  openDeliveries: number;
  /** Whether a session crews it now: that session loses it. */
  isCrewed: boolean;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  isPending: boolean;
  /** Why the last try failed; the dialog stays open and nothing changed. */
  error?: string;
  onConfirm: () => void;
}

function consequencesOf(isCrewed: boolean): Consequence[] {
  return [
    ...(isCrewed ? [{ icon: UserX, text: 'The session crewing it loses it now.' }] : []),
    { icon: KeyRound, text: 'Its secret stops working.' },
    { icon: Tag, text: 'It is never crewed or messaged again, and its name is free for a new ship.' },
    { icon: Users, text: 'Deliveries to its type stay, for the other ships of the type.' },
  ];
}

/** The open deliveries: a calm note for a clean inbox, an attention panel naming what is lost. */
function DeliveriesNote({ openDeliveries }: { openDeliveries: number }) {
  if (openDeliveries === 0) {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-tone-ok-border bg-tone-ok-bg px-3 py-2 text-meta text-tone-ok-fg">
        <CircleCheck aria-hidden className="size-(--size-icon-sm) shrink-0" />
        Its inbox is empty, so no deliveries are affected.
      </p>
    );
  }
  return (
    <div className="flex gap-2 rounded-lg border border-tone-attention-border bg-tone-attention-bg p-3 text-tone-attention-fg">
      <TriangleAlert aria-hidden className="mt-0.5 size-(--size-icon) shrink-0" />
      <div className="flex flex-col gap-1">
        <p className="text-body font-medium">{abandonedLine(openDeliveries)}</p>
        <p className="text-meta text-foreground">Each is marked Abandoned and its sender can see that.</p>
      </div>
    </div>
  );
}

/**
 * The open dialog's body. Its typed text lives here, so it starts empty each
 * time the dialog opens.
 */
function RetireDialogBody(props: RetireDialogProps) {
  const { shipName, openDeliveries, isCrewed, isPending, error, onConfirm } = props;
  const [typed, setTyped] = useState('');
  const isTypingNeeded = openDeliveries > 0;
  const isConfirmed = !isTypingNeeded || isTypedMatch(shipName, typed);

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>Retire {shipName}?</AlertDialogTitle>
        <AlertDialogDescription>
          Retiring ends this ship for good. Its history stays available read-only. This can’t be undone.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <DeliveriesNote openDeliveries={openDeliveries} />
      <ConsequenceList consequences={consequencesOf(isCrewed)} />
      {isTypingNeeded ? <TypedConfirm expected={shipName} value={typed} onValueChange={setTyped} /> : null}
      {error === undefined ? null : (
        <InlineError title="Couldn’t retire the ship" description={`${error} Nothing changed.`} />
      )}
      <AlertDialogFooter>
        <AlertDialogClose render={<Button disabled={isPending} />}>Cancel</AlertDialogClose>
        <Button variant="destructive" isLoading={isPending} disabled={!isConfirmed} onClick={onConfirm}>
          {retireButtonLabel(openDeliveries)}
        </Button>
      </AlertDialogFooter>
    </>
  );
}

/**
 * Retire a ship for good (docs/design/png/RetireDialog.png): destructive and
 * irreversible. A clean inbox retires with one normal confirm; open
 * deliveries need the TypedConfirm, because retiring abandons them. The
 * destructive button names the consequence. Desktop: a dialog; phone: a
 * bottom sheet.
 */
export function RetireDialog(props: RetireDialogProps) {
  const { isOpen, onOpenChange, isPending } = props;

  return (
    <AlertDialog
      open={isOpen}
      onOpenChange={(isNowOpen) => {
        if (!isPending) {
          onOpenChange(isNowOpen);
        }
      }}
    >
      <AlertDialogContent data-testid="retire-dialog" className={dialogSurface.phoneSheet}>
        <RetireDialogBody {...props} />
      </AlertDialogContent>
    </AlertDialog>
  );
}
