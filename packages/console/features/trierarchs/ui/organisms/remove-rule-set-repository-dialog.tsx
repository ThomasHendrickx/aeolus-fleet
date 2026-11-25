import type { ReactNode } from 'react';
import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, Button, dialogSurface,
} from '@aeolus-fleet/ui';

/** Removal keeps any configured floor names and confirms the effect before saving. */
export function RemoveRuleSetRepositoryDialog({ repository, isPending, isDisabled, hasFailed = false, notice, onClose, onConfirm }: {
  repository: string;
  isPending: boolean;
  isDisabled: boolean;
  hasFailed?: boolean;
  notice?: ReactNode;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open onOpenChange={(isOpen) => { if (!isOpen && !isPending) onClose(); }}>
      <AlertDialogContent
        className={dialogSurface.phoneSheet}
        data-testid="rule-sets-remove-dialog"
        data-state={isPending ? 'pending' : hasFailed ? 'failure' : 'idle'}
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="break-all">Remove {repository}?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the repository and its read token. Its rule sets no longer come from this repository.
            Any floor names remain configured and show as unavailable if no rule set offers them.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {notice}
        <AlertDialogFooter>
          <Button disabled={isPending} onClick={onClose}>Cancel</Button>
          <Button
            variant="destructive"
            isLoading={isPending}
            disabled={isDisabled}
            onClick={onConfirm}
            data-testid="rule-sets-confirm-remove"
          >
            {isPending ? 'Removing…' : 'Remove repository'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
