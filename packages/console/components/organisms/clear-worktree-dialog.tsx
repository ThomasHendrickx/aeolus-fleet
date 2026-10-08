'use client';

import { Button } from '../atoms/button';
import { AlertDialog, AlertDialogClose, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../atoms/alert-dialog';
import { dialogSurface } from '../atoms/dialog-surface';
import { InlineError } from '../molecules/inline-error';

/** The kept worktree to delete, as its machine's page shows it. */
export interface WorktreeToClear {
  repository: string;
  /** The ship it belonged to, by name when the fleet knows it. */
  shipName: string;
  machineName: string;
}

interface ClearWorktreeDialogProps {
  /** The confirm is open while one is given. */
  worktree: WorktreeToClear | undefined;
  onOpenChange: (isOpen: boolean) => void;
  isPending: boolean;
  /** Why the server refused it; nothing changed. */
  error?: string;
  onClear: () => void;
}

/**
 * Delete a kept worktree: confirm (#325, decision 0032). Its uncommitted
 * changes are lost. The request goes to the trierarch, which removes the
 * worktree on its next pass; until then the worktree shows Clearing. A
 * request is never withdrawn.
 */
export function ClearWorktreeDialog({ worktree, onOpenChange, isPending, error, onClear }: ClearWorktreeDialogProps) {
  return (
    <AlertDialog
      open={worktree !== undefined}
      onOpenChange={(isOpen) => {
        if (!isPending) {
          onOpenChange(isOpen);
        }
      }}
    >
      <AlertDialogContent data-testid="clear-worktree-dialog" className={dialogSurface.phoneSheet}>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete the kept <span className="font-mono">{worktree?.repository}</span> worktree of {worktree?.shipName}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {worktree === undefined
              ? null
              : `${worktree.machineName} removes it on its next pass, with its uncommitted changes. They can't be recovered, and the request can't be withdrawn.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error === undefined ? null : <InlineError title="Couldn’t delete the worktree" description={`Refused: ${error}. Nothing changed.`} />}
        <AlertDialogFooter>
          <AlertDialogClose render={<Button disabled={isPending} />}>Cancel</AlertDialogClose>
          <Button variant="destructive" isLoading={isPending} data-testid="clear-worktree-confirm" onClick={onClear}>
            Delete worktree
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
