'use client';

import { Button, dialogSurface } from '@aeolus-fleet/common/header';
import { AlertDialog, AlertDialogClose, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../../../components/atoms/alert-dialog';
import { InlineError } from '../../../../components/molecules/inline-error';

interface RemoveScopeDialogProps {
  /** The fleet scope to remove; the confirm is open while one is given. */
  scope: string | undefined;
  onOpenChange: (isOpen: boolean) => void;
  isPending: boolean;
  /** Why the server refused it, naming how many ships hold it; nothing changed. */
  error?: string;
  onRemove: (scope: string) => void;
}

/**
 * Remove… (design gateway-scopes, 4.1): one of the fleet's own scopes goes,
 * and the last of a namespace frees it. Refused while a ship holds the scope,
 * the server naming how many; the refusal shows inline.
 */
export function RemoveScopeDialog({ scope, onOpenChange, isPending, error, onRemove }: RemoveScopeDialogProps) {
  return (
    <AlertDialog
      open={scope !== undefined}
      onOpenChange={(isOpen) => {
        if (!isPending) {
          onOpenChange(isOpen);
        }
      }}
    >
      <AlertDialogContent data-testid="remove-scope-dialog" className={dialogSurface.phoneSheet}>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Remove <span className="font-mono">{scope}</span>?
          </AlertDialogTitle>
          <AlertDialogDescription>No ship can be granted it any more. Only a scope no ship holds is removed: revoke it from them first.</AlertDialogDescription>
        </AlertDialogHeader>
        {error === undefined ? null : <InlineError title="Couldn’t remove the scope" description={`Refused: ${error}. Nothing changed.`} />}
        <AlertDialogFooter>
          <AlertDialogClose render={<Button disabled={isPending} />}>Cancel</AlertDialogClose>
          <Button
            variant="destructive"
            isLoading={isPending}
            data-testid="remove-scope-confirm"
            onClick={() => {
              if (scope !== undefined) {
                onRemove(scope);
              }
            }}
          >
            {isPending ? 'Removing…' : 'Remove scope'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
