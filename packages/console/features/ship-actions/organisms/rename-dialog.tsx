'use client';

import { CircleCheck, CircleX, TriangleAlert } from 'lucide-react';
import { useId, useState } from 'react';

import { useConsoleConstants } from '../../../lib/console-constants';
import { classNames } from '../../../lib/class-names';
import { asHandle, checkShipName } from '../../../lib/ship-name';
import { Button } from '../../../components/atoms/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/atoms/dialog';
import { dialogSurface } from '../../../components/atoms/dialog-surface';
import { Input } from '../../../components/atoms/input';
import { Label } from '../../../components/atoms/label';
import { InlineError } from '../../../components/molecules/inline-error';

interface RenameDialogProps {
  shipName: string;
  /** The names of the fleet's active ships, to say early whether a name is free. */
  activeNames: readonly string[];
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  isPending: boolean;
  /** Why the last try failed; the dialog stays open with the input kept. */
  error?: string;
  onSubmit: (name: string) => void;
}

/** The open dialog's fields: they start empty each time it opens. */
function RenameDialogBody({ shipName, activeNames, isPending, error, onSubmit }: Omit<RenameDialogProps, 'isOpen' | 'onOpenChange'>) {
  const { shipHandleMaxLength } = useConsoleConstants();
  const nameId = useId();
  const statusId = useId();
  const [name, setName] = useState('');
  const check = checkShipName(name, { activeNames, current: shipName });
  const isProblem = check.kind === 'invalid' || check.kind === 'reserved' || check.kind === 'taken';
  const canRename = check.kind === 'available';

  return (
    <form
      noValidate
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        if (canRename) {
          onSubmit(name);
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>Rename {shipName}</DialogTitle>
        <DialogDescription>The ship keeps its id, inbox and history.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <Label htmlFor={nameId}>New name</Label>
          <span className="text-caption text-muted-foreground tabular-nums">
            {name.length} / {shipHandleMaxLength}
          </span>
        </div>
        <div className="relative">
          <Input
            id={nameId}
            isMono
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder={shipName}
            data-testid="rename-name"
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
        <p
          id={statusId}
          aria-live="polite"
          className={classNames('text-meta', isProblem ? 'text-destructive-text' : 'text-muted-foreground')}
        >
          {check.message}
        </p>
      </div>
      <div className="flex gap-2 rounded-lg border border-tone-waiting-border bg-tone-waiting-bg p-3 text-tone-waiting-fg">
        <TriangleAlert aria-hidden className="mt-0.5 size-(--size-icon) shrink-0" />
        <div className="flex flex-col gap-1">
          <p className="text-body font-medium">Ships that address {shipName} by name stop reaching it</p>
          <p className="text-meta text-foreground">Messages already sent are unaffected, because they are stored by ship id.</p>
        </div>
      </div>
      {error === undefined ? null : (
        <InlineError title="Couldn’t rename the ship" description={`${error} Nothing changed.`} />
      )}
      <DialogFooter>
        <DialogClose render={<Button type="button" disabled={isPending} />}>Cancel</DialogClose>
        <Button type="submit" variant="primary" isLoading={isPending} disabled={!canRename} data-testid="rename-submit">
          {isPending ? 'Renaming' : 'Rename ship'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * Rename a ship (docs/design/png/RenameDialog.png), any but argo or a retired
 * one: the same live name check as commissioning, the fact that ships
 * addressing the old name stop reaching it. The dialog is the confirm
 * (docs/design/conventions.md, "Destructive actions"): a normal confirm. Desktop:
 * a dialog; phone: full screen.
 */
export function RenameDialog(props: RenameDialogProps) {
  const { isOpen, onOpenChange, isPending } = props;
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(isNowOpen) => {
        if (!isPending) {
          onOpenChange(isNowOpen);
        }
      }}
    >
      <DialogContent data-testid="rename-dialog" className={dialogSurface.phoneFullScreen}>
        <RenameDialogBody {...props} />
      </DialogContent>
    </Dialog>
  );
}
