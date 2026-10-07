'use client';

import { SHIP_HANDLE_MAX_LENGTH } from '@aeolus-fleet/common';
import { CircleAlert, CircleCheck, CircleX, Info } from 'lucide-react';
import { useId, useState } from 'react';

import { classNames } from '../../lib/class-names';
import { asHandle, checkShipName } from '../../lib/ship-name';
import type { JoinedMachine } from '../../lib/trierarch-plugin';
import { Button } from '../atoms/button';
import { CodeBlock } from '../atoms/code-block';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../atoms/dialog';
import { dialogSurface } from '../atoms/dialog-surface';
import { Input } from '../atoms/input';
import { Label } from '../atoms/label';
import { CrewLines } from '../molecules/crew-lines';
import { InlineError } from '../molecules/inline-error';

interface JoinMachineDialogProps {
  /** The names of the fleet's active ships, to say early whether a name is free. */
  activeNames: readonly string[];
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  isPending: boolean;
  /** Why the last try failed; the dialog stays open with the input kept. */
  error?: string;
  /** The joined machine, once: its setup line and starting prompt are shown only now. */
  joined?: JoinedMachine;
  onSubmit: (name: string) => void;
}

/** The name the operator gives the machine: no prefill; the trierarch's ship goes by it (#245, h). */
function NameStep({ activeNames, isPending, error, onSubmit }: Pick<JoinMachineDialogProps, 'activeNames' | 'isPending' | 'error' | 'onSubmit'>) {
  const nameId = useId();
  const statusId = useId();
  const [name, setName] = useState('');
  const check = checkShipName(name, { activeNames });
  const isProblem = check.kind === 'invalid' || check.kind === 'reserved' || check.kind === 'taken';
  const canJoin = check.kind === 'available';

  return (
    <form
      noValidate
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        if (canJoin) {
          onSubmit(name);
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>Join a machine</DialogTitle>
        <DialogDescription>
          The trierarch plugin commissions a trierarch ship of this name. You then run its setup line on the machine, and the trierarch there starts sessions for
          the crew requests it is given.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <Label htmlFor={nameId}>Name</Label>
          <span className="text-caption text-muted-foreground tabular-nums">
            {name.length} / {SHIP_HANDLE_MAX_LENGTH}
          </span>
        </div>
        <div className="relative">
          <Input
            id={nameId}
            isMono
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="trierarch-mac"
            data-testid="join-machine-name"
            aria-invalid={isProblem ? true : undefined}
            aria-describedby={statusId}
            className="pr-9 max-sm:h-(--size-control-touch) max-sm:text-input-touch"
            value={name}
            onChange={(event) => {
              setName(asHandle(event.target.value));
            }}
          />
          {check.kind === 'available' ? (
            <CircleCheck aria-hidden className="absolute top-1/2 right-3 size-(--size-icon) -translate-y-1/2 text-tone-ok-fg" />
          ) : isProblem ? (
            <CircleX aria-hidden className="absolute top-1/2 right-3 size-(--size-icon) -translate-y-1/2 text-destructive-text" />
          ) : null}
        </div>
        <p id={statusId} aria-live="polite" className={classNames('text-meta', isProblem ? 'text-destructive-text' : 'text-muted-foreground')}>
          {check.message}
        </p>
      </div>
      {error === undefined ? null : <InlineError title="Couldn’t join the machine" description={`${error} Nothing changed.`} />}
      <DialogFooter>
        <DialogClose render={<Button type="button" disabled={isPending} />}>Cancel</DialogClose>
        <Button type="submit" variant="primary" isLoading={isPending} disabled={!canJoin} data-testid="join-machine-submit">
          {isPending ? 'Joining' : 'Join machine'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** The joined machine's setup line, then its starting prompt and crew lines: each shown once, each with its copy button. */
function JoinedStep({ joined }: { joined: JoinedMachine }) {
  const [hasCopyFailed, setHasCopyFailed] = useState(false);
  const copied = () => {
    setHasCopyFailed(false);
  };
  const failed = () => {
    setHasCopyFailed(true);
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>{joined.name} joined</DialogTitle>
        <DialogDescription>Run the setup line on the machine. It installs the trierarch, which then crews {joined.name} and reports what the machine offers.</DialogDescription>
      </DialogHeader>
      <p className="flex gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-meta text-foreground">
        <Info aria-hidden className="mt-0.5 size-(--size-icon-sm) shrink-0 text-muted-foreground" />
        <span>
          <span className="font-medium">Shown once. Copy it now.</span> It carries the ship’s secret. If you lose it, get a new starting prompt on {joined.name}’s
          ship page.
        </span>
      </p>
      <CodeBlock
        label="Setup line"
        code={joined.setupLine}
        isWrapped
        copyLabel={`Copy the setup line for ${joined.name}`}
        codeTestId="join-machine-setup-line"
        copyTestId="join-machine-setup-line-copy"
        onCopied={copied}
        onCopyFailed={failed}
      />
      <CodeBlock
        label={`Starting prompt for ${joined.name}`}
        code={joined.prompt}
        isWrapped
        copyLabel={`Copy the starting prompt for ${joined.name}`}
        codeTestId="join-machine-prompt"
        onCopied={copied}
        onCopyFailed={failed}
      />
      <CrewLines crewLines={joined.crewLines} subject={joined.name} testIdPrefix="join-machine-crew-line" onCopied={copied} onCopyFailed={failed} />
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
 * Join a machine (#245; follows RenameDialog for the name, then
 * StartingPromptDialog for what is shown once): the operator names it, the
 * trierarch plugin commissions its trierarch's ship, and the dialog shows its
 * setup line and starting prompt once. Desktop: a dialog; phone: full screen.
 */
export function JoinMachineDialog(props: JoinMachineDialogProps) {
  const { isOpen, onOpenChange, isPending, joined } = props;
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(isNowOpen) => {
        if (!isPending) {
          onOpenChange(isNowOpen);
        }
      }}
    >
      <DialogContent size="md" data-testid="join-machine-dialog" className={dialogSurface.phoneFullScreen}>
        {joined === undefined ? <NameStep {...props} /> : <JoinedStep joined={joined} />}
      </DialogContent>
    </Dialog>
  );
}
