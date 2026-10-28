'use client';

import { CircleAlert, TriangleAlert } from 'lucide-react';
import { useState } from 'react';

import { Button, Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, dialogSurface, DialogTitle } from '@aeolus-fleet/common/header';
import { InlineError } from '../../../../components/molecules/inline-error';
import { SetupLineBlock } from '../molecules/setup-line-block';

interface NewSetupLineDialogProps {
  /** The machine's name, which its trierarch's ship goes by. */
  name: string;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  isPending: boolean;
  /** Why the last try failed; the dialog stays on the confirm. */
  error?: string;
  /** The new setup line, once: shown only now. */
  setupLine?: string;
  onConfirm: () => void;
}

/** What getting a new line does, before it is done: the old line stops working, and a trierarch running with it loses its crew. */
function ConfirmStep({ name, isPending, error, onConfirm }: Pick<NewSetupLineDialogProps, 'name' | 'isPending' | 'error' | 'onConfirm'>) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Get a new setup line for {name}?</DialogTitle>
        <DialogDescription>The trierarch plugin gives {name}’s ship a new secret and builds the setup line with it.</DialogDescription>
      </DialogHeader>
      <p className="flex gap-2 rounded-lg border border-tone-attention-border bg-tone-attention-bg px-3 py-2 text-meta text-tone-attention-fg">
        <TriangleAlert aria-hidden className="mt-0.5 size-(--size-icon-sm) shrink-0" />
        <span>The old setup line stops working. A trierarch already running with it loses its crew; run the new line on the machine to start it again.</span>
      </p>
      {error === undefined ? null : <InlineError title="Couldn’t get a new setup line" description={`${error} Nothing changed.`} />}
      <DialogFooter>
        <DialogClose render={<Button type="button" disabled={isPending} />}>Cancel</DialogClose>
        <Button variant="primary" isLoading={isPending} onClick={onConfirm} data-testid="new-setup-line-confirm">
          {isPending ? 'Getting new setup line' : 'Get new setup line'}
        </Button>
      </DialogFooter>
    </>
  );
}

/** The new setup line, shown once with its copy button, as the join dialog shows a joined machine's. */
function LineStep({ name, setupLine }: { name: string; setupLine: string }) {
  const [hasCopyFailed, setHasCopyFailed] = useState(false);
  return (
    <>
      <DialogHeader>
        <DialogTitle>New setup line for {name}</DialogTitle>
        <DialogDescription>Run the setup line on the machine. It installs the trierarch, which then crews {name} and reports what the machine offers.</DialogDescription>
      </DialogHeader>
      <SetupLineBlock
        name={name}
        setupLine={setupLine}
        testIdPrefix="new-setup-line"
        onCopied={() => {
          setHasCopyFailed(false);
        }}
        onCopyFailed={() => {
          setHasCopyFailed(true);
        }}
      />
      <p role="status" className="flex items-center gap-1.5 text-meta text-destructive-text empty:hidden">
        {hasCopyFailed ? (
          <>
            <CircleAlert aria-hidden className="size-(--size-icon-sm) shrink-0" />
            Could not copy: select the text and copy it by hand.
          </>
        ) : null}
      </p>
      <DialogFooter>
        <DialogClose render={<Button variant="primary" />}>Done</DialogClose>
      </DialogFooter>
    </>
  );
}

/**
 * A lost setup line got again (#1239), from the machine's card: a confirm
 * that the old line stops working, then the new line, shown once. Desktop:
 * a dialog; phone: full screen.
 */
export function NewSetupLineDialog({ name, isOpen, onOpenChange, isPending, error, setupLine, onConfirm }: NewSetupLineDialogProps) {
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(isNowOpen) => {
        if (!isPending) {
          onOpenChange(isNowOpen);
        }
      }}
    >
      <DialogContent size="md" data-testid="new-setup-line-dialog" className={dialogSurface.phoneFullScreen}>
        {setupLine === undefined ? <ConfirmStep name={name} isPending={isPending} error={error} onConfirm={onConfirm} /> : <LineStep name={name} setupLine={setupLine} />}
      </DialogContent>
    </Dialog>
  );
}
