'use client';

import { SHIP_HANDLE_MAX_LENGTH, shipHandleSchema, type ListedShip } from '@aeolus-fleet/common';
import { CircleCheck, CircleX, Tag } from 'lucide-react';
import { useId, useState } from 'react';

import { classNames } from '../../lib/class-names';
import { asHandle, checkShipName, typeHint } from '../../lib/ship-name';
import { Button } from '../atoms/button';
import { Combobox } from '../atoms/combobox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../atoms/dialog';
import { dialogSurface } from '../atoms/dialog-surface';
import { Input } from '../atoms/input';
import { Label } from '../atoms/label';
import { Textarea } from '../atoms/textarea';
import { InlineError } from '../molecules/inline-error';

interface CommissionDialogProps {
  /** The fleet's active ships: their names are taken, their types suggested. */
  activeShips: readonly ListedShip[];
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  isPending: boolean;
  /** Why the last try failed; the dialog stays open with the input kept. */
  error?: string;
  onSubmit: (ship: { name: string; type: string; note?: string }) => void;
}

/** The open dialog's fields: they start empty each time it opens. */
function CommissionDialogBody({ activeShips, isPending, error, onSubmit }: Omit<CommissionDialogProps, 'isOpen' | 'onOpenChange'>) {
  const nameId = useId();
  const nameStatusId = useId();
  const typeId = useId();
  const typeHintId = useId();
  const noteId = useId();
  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [note, setNote] = useState('');
  const check = checkShipName(name, { activeNames: activeShips.map((ship) => ship.name) });
  const isNameProblem = check.kind === 'invalid' || check.kind === 'reserved' || check.kind === 'taken';
  const trimmedType = type.trim();
  const isTypeValid = shipHandleSchema.safeParse(trimmedType).success;
  const isTypeProblem = trimmedType !== '' && !isTypeValid;
  const types = [...new Set(activeShips.map((ship) => ship.type))].sort();
  const canCommission = check.kind === 'available' && isTypeValid;

  return (
    <form
      noValidate
      data-testid="commission-form"
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        if (canCommission) {
          onSubmit({ name, type: trimmedType, ...(note.trim() === '' ? {} : { note }) });
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>Commission a ship</DialogTitle>
        <DialogDescription>
          A ship is a durable agent identity with its own inbox. Next, you get the starting prompt.
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
            placeholder="e.g. reviewer-02"
            data-testid="commission-name"
            aria-invalid={isNameProblem ? true : undefined}
            aria-describedby={nameStatusId}
            className="pr-9 max-sm:h-(--size-control-touch) max-sm:text-input-touch"
            value={name}
            onChange={(event) => {
              setName(asHandle(event.target.value));
            }}
          />
          {check.kind === 'available' ? (
            <CircleCheck aria-hidden className="absolute top-1/2 right-3 size-(--size-icon) -translate-y-1/2 text-tone-ok-fg" />
          ) : isNameProblem ? (
            <CircleX aria-hidden className="absolute top-1/2 right-3 size-(--size-icon) -translate-y-1/2 text-destructive-text" />
          ) : null}
        </div>
        <p
          id={nameStatusId}
          aria-live="polite"
          className={classNames('text-meta', isNameProblem ? 'text-destructive-text' : 'text-muted-foreground')}
        >
          {check.message}
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={typeId}>Type</Label>
        <Combobox
          id={typeId}
          options={types.map((each) => ({ value: each, label: each }))}
          value={type === '' ? null : type}
          onValueChange={(value) => {
            setType(value ?? '');
          }}
          isFreeText
          toQuery={asHandle}
          leadingIcon={<Tag />}
          placeholder="e.g. reviewer"
          isInvalid={isTypeProblem}
          aria-describedby={typeHintId}
          data-testid="commission-type"
        />
        <p id={typeHintId} className={classNames('text-meta', isTypeProblem ? 'text-destructive-text' : 'text-muted-foreground')}>
          {isTypeProblem
            ? `Use 1 to ${String(SHIP_HANDLE_MAX_LENGTH)} lowercase letters, digits, hyphens or colons.`
            : typeHint(type, activeShips.filter((ship) => ship.type === trimmedType).length)}
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={noteId}>Note (optional)</Label>
        <Textarea
          id={noteId}
          rows={2}
          data-testid="commission-note"
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
      </div>
      {error === undefined ? null : <InlineError title="Not commissioned" description={error} />}
      <DialogFooter>
        <DialogClose render={<Button type="button" disabled={isPending} />}>Cancel</DialogClose>
        <Button type="submit" variant="primary" isLoading={isPending} disabled={!canCommission} data-testid="commission-submit">
          {isPending ? 'Commissioning' : 'Commission ship'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * Step 1 of commissioning (docs/design/png/CommissionForm.png): the name,
 * checked as the operator types (the rule, a counter, and one status line
 * that says available or why not), the type with suggestions from the fleet
 * and what it means, and the optional note the blueprint keeps. The button
 * stays disabled until the name is free and the type a handle. Desktop: a
 * dialog; phone: full screen. On success the page hands over to the
 * StartingPromptDialog.
 */
export function CommissionDialog(props: CommissionDialogProps) {
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
      <DialogContent size="md" data-testid="commission-dialog" className={dialogSurface.phoneFullScreen}>
        <CommissionDialogBody {...props} />
      </DialogContent>
    </Dialog>
  );
}
