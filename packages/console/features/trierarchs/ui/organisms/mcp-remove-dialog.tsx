import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  dialogSurface,
} from '@aeolus-fleet/ui';
import type { McpServer } from '../../services/mcp-configuration';
import { McpSaveErrorNotice, type McpSaveError } from './mcp-save-error';

/** Normal confirmation states which crew requests and sessions a removal affects. */
export function McpRemoveDialog({
  name,
  server,
  isPending,
  error,
  isReading,
  onReadAgain,
  onClose,
  onConfirm,
}: {
  name: string;
  server?: McpServer;
  isPending: boolean;
  error?: McpSaveError;
  isReading?: boolean;
  onReadAgain: () => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen && !isPending) onClose();
      }}
    >
      <AlertDialogContent className={dialogSurface.phoneSheet} data-testid="mcp-remove-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {name}?</AlertDialogTitle>
          <AlertDialogDescription render={<div />}>
            <ul className="flex list-disc flex-col gap-1 pl-5">
              {server === undefined ? (
                <>
                  <li>No server uses it.</li>
                  <li>Its value is deleted and cannot be read back.</li>
                </>
              ) : (
                <>
                  <li>Crew requests that name {name} will not be placed.</li>
                  <li>Running sessions lose its tools once their machine applies the change.</li>
                  {server.credential === undefined ? null : (
                    <li>Its secret {server.credential.secret} stays. Remove it under Secrets once no server uses it.</li>
                  )}
                </>
              )}
            </ul>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <McpSaveErrorNotice error={error} subject={server === undefined ? 'secret' : 'server'} onReadAgain={onReadAgain} isReading={isReading} />
        <AlertDialogFooter>
          <Button disabled={isPending} onClick={onClose} data-testid="mcp-cancel">
            Cancel
          </Button>
          <Button
            variant="destructive"
            isLoading={isPending}
            disabled={error?.kind === 'no-answer' || error?.kind === 'read-failed' || isReading}
            onClick={onConfirm}
            data-testid="mcp-submit"
          >
            {isPending ? 'Removing…' : error?.kind === 'stale' ? 'Save again' : server === undefined ? 'Remove secret' : 'Remove server'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
