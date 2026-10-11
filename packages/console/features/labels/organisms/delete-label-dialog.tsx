'use client';

import type { LabelRow } from '../../../lib/labels';
import { Button } from '../../../components/atoms/button';
import { AlertDialog, AlertDialogClose, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../../components/atoms/alert-dialog';
import { dialogSurface } from '../../../components/atoms/dialog-surface';
import { InlineError } from '../../../components/molecules/inline-error';

interface DeleteLabelDialogProps {
  /** Your label no ship carries; the confirm is open while one is given. */
  row: LabelRow | undefined;
  onOpenChange: (isOpen: boolean) => void;
  isPending: boolean;
  /** Why the server refused it, naming the ships that carry it; nothing changed. */
  error?: string;
  onDelete: (labelId: LabelRow['labelId']) => void;
}

/**
 * Delete label… (#102, point 12; canvas LbListMenu): a label no ship carries
 * goes with its values, and its key is free again. Offered only while no ship
 * carries it; the server refuses it otherwise, naming the ships.
 */
export function DeleteLabelDialog({ row, onOpenChange, isPending, error, onDelete }: DeleteLabelDialogProps) {
  return (
    <AlertDialog
      open={row !== undefined}
      onOpenChange={(isOpen) => {
        if (!isPending) {
          onOpenChange(isOpen);
        }
      }}
    >
      <AlertDialogContent data-testid="delete-label-dialog" className={dialogSurface.phoneSheet}>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete <span className="font-mono">{row?.key}</span>?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {row === undefined ? null : `Its ${row.values.length === 1 ? 'value goes' : `${String(row.values.length)} values go`} with it, and its key is free again. No ship carries it, so no ship changes.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error === undefined ? null : <InlineError title="Couldn’t delete the label" description={`Refused: ${error}. Nothing changed.`} />}
        <AlertDialogFooter>
          <AlertDialogClose render={<Button disabled={isPending} />}>Cancel</AlertDialogClose>
          <Button
            variant="destructive"
            isLoading={isPending}
            data-testid="delete-label-confirm"
            onClick={() => {
              if (row !== undefined) {
                onDelete(row.labelId);
              }
            }}
          >
            Delete label
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
