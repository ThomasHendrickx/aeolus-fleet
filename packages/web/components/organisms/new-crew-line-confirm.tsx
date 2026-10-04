'use client';

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

interface NewCrewLineConfirmProps {
  memberName: string;
  /** What a new line ends: a session, or an unclaimed line; none when it ends nothing. */
  replacedText?: string;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onConfirm: () => void;
}

/**
 * Asks before Get new crew line, always (docs/design/conventions.md,
 * "Destructive actions"): a normal confirm saying what the new line ends.
 * Primary, not destructive. Desktop: a dialog; phone: a bottom sheet.
 */
export function NewCrewLineConfirm({ memberName, replacedText, isOpen, onOpenChange, onConfirm }: NewCrewLineConfirmProps) {
  return (
    <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="new-crew-line-confirm" className={dialogSurface.phoneSheet}>
        <AlertDialogHeader>
          <AlertDialogTitle>Get a new crew line for {memberName}?</AlertDialogTitle>
          <AlertDialogDescription>{replacedText ?? 'Its new secret is shown once, with its launch note.'}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button />}>Cancel</AlertDialogClose>
          <Button variant="primary" data-testid="new-crew-line-confirm-submit" onClick={onConfirm}>
            Get new crew line
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
