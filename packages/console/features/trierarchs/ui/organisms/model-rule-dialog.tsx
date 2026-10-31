'use client';

import { Button, dialogSurface } from '@aeolus-fleet/ui';
import { AlertDialog, AlertDialogClose, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../../../components/atoms/alert-dialog';
import { InlineError } from '../../../../components/molecules/inline-error';

/** A Switch that changes the whole fleet: the first model enabled starts the rule, the last disabled ends it. */
export interface ModelRuleChange {
  model: string;
  kind: 'first' | 'last';
}

interface ModelRuleDialogProps {
  /** The confirm is open while one is given. */
  change: ModelRuleChange | undefined;
  onOpenChange: (isOpen: boolean) => void;
  isPending: boolean;
  /** Why the trierarch plugin refused it; nothing changed. */
  error?: string;
  onConfirm: () => void;
}

/**
 * Asks before a Switch changes the whole fleet (model governance, M7):
 * enabling the first model lets only enabled models be placed, disabling the
 * last allows every model again. Crews already running keep their model.
 */
export function ModelRuleDialog({ change, onOpenChange, isPending, error, onConfirm }: ModelRuleDialogProps) {
  const isFirst = change?.kind === 'first';
  return (
    <AlertDialog
      open={change !== undefined}
      onOpenChange={(isOpen) => {
        if (!isPending) {
          onOpenChange(isOpen);
        }
      }}
    >
      <AlertDialogContent data-testid="model-rule-dialog" className={dialogSurface.phoneSheet}>
        <AlertDialogHeader>
          <AlertDialogTitle>{isFirst ? 'Allow only enabled models?' : 'Allow every model again?'}</AlertDialogTitle>
          <AlertDialogDescription>
            {change === undefined ? null : isFirst ? (
              <>
                Enabling <span className="font-mono">{change.model}</span> changes the whole fleet: only enabled models are placed, and crew requests for any other model wait with
                “model disabled”. Crews already running keep their model.
              </>
            ) : (
              <>
                <span className="font-mono">{change.model}</span> is the last enabled model. Disabling it changes the whole fleet: every model a trierarch reports is placed again.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error === undefined ? null : <InlineError title={isFirst ? 'Couldn’t enable the model' : 'Couldn’t disable the model'} description={`${error}. Nothing changed.`} />}
        <AlertDialogFooter>
          <AlertDialogClose render={<Button disabled={isPending} />}>Cancel</AlertDialogClose>
          <Button variant="primary" isLoading={isPending} data-testid="model-rule-confirm" onClick={onConfirm}>
            {isPending ? (isFirst ? 'Enabling…' : 'Disabling…') : isFirst ? 'Enable and allow only it' : 'Disable and allow every model'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
