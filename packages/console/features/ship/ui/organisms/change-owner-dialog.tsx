'use client';

import type { ShipId } from '@aeolus-fleet/common';
import { UserRound } from 'lucide-react';
import { useId, useState } from 'react';

import { Button, Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, dialogSurface, DialogTitle, InlineError, Label } from '@aeolus-fleet/ui';
import { Combobox, type ComboboxOption } from '../../../../components/atoms/combobox';

/** A ship that may own another, by id and name. */
export interface OwnerChoice {
  id: ShipId;
  name: string;
}

interface ChangeOwnerDialogProps {
  shipName: string;
  /** The ship that owns it now: in the field when the dialog opens, and Change owner stays off while it is picked. */
  currentOwner: OwnerChoice;
  /** The fleet's active person ships whose names hold what was typed; undefined until read. */
  personShips: readonly OwnerChoice[] | undefined;
  /** argo, offered last and apart; `isYou` when this session is argo's. Undefined until read. */
  argo: (OwnerChoice & { isYou: boolean }) | undefined;
  /** What was typed in the field: the person ships whose names hold it are read. */
  onQueryChange?: (query: string) => void;
  /** The person ships could not be read: why, and how to read them again. */
  readFailure?: { message: string; onRetry: () => void };
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  isPending: boolean;
  /** The fleet's reason the last try was refused; the dialog stays open with the pick kept. */
  error?: string;
  onSubmit: (ownerShipId: ShipId) => void;
}

const CURRENT = <span className="text-meta text-muted-foreground">Current</span>;

/** The open dialog's field: it starts at the current owner each time it opens. */
function ChangeOwnerDialogBody({ shipName, currentOwner, personShips, argo, onQueryChange, readFailure, isPending, error, onSubmit }: Omit<ChangeOwnerDialogProps, 'isOpen' | 'onOpenChange'>) {
  const ownerId = useId();
  const hintId = useId();
  const [picked, setPicked] = useState<ShipId | null>(currentOwner.id);
  const canChange = picked !== null && picked !== currentOwner.id;
  // The current owner is offered even where the search did not find it, so the field opens with it.
  const isCurrentListed = currentOwner.id === argo?.id || personShips?.some((ship) => ship.id === currentOwner.id) === true;
  const people = isCurrentListed ? (personShips ?? []) : [currentOwner, ...(personShips ?? [])];
  const choices: readonly OwnerChoice[] = argo === undefined ? people : [...people, argo];
  const options: ComboboxOption[] = people.map((ship) => ({ value: ship.id, label: ship.name, ...(ship.id === currentOwner.id ? { trailing: CURRENT } : {}) }));
  const apartOptions: ComboboxOption[] =
    argo === undefined
      ? []
      : [
          {
            value: argo.id,
            label: argo.isYou ? `${argo.name} (you)` : argo.name,
            trailing: argo.id === currentOwner.id ? CURRENT : <span className="text-meta text-muted-foreground">No person answers</span>,
          },
        ];

  return (
    <form
      noValidate
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        if (canChange) {
          onSubmit(picked);
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>Change the owner of {shipName}</DialogTitle>
        <DialogDescription>An owner is an active person’s ship or argo.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ownerId}>Owner</Label>
        <Combobox
          id={ownerId}
          options={options}
          apartOptions={apartOptions}
          hasListButton
          value={picked}
          onValueChange={(value) => {
            setPicked(choices.find((choice) => choice.id === value)?.id ?? null);
          }}
          {...(onQueryChange === undefined ? {} : { onQueryChange })}
          emptyText={(query) => `No person ship is named ${query}.`}
          leadingIcon={<UserRound />}
          placeholder={personShips === undefined ? 'Reading the person ships' : 'Pick an owner'}
          aria-describedby={hintId}
          data-testid="change-owner-field"
        />
        {readFailure === undefined ? (
          <p id={hintId} className="text-meta text-muted-foreground">
            The person who answers for {shipName}: its questions, gates and trouble go to their ship.
          </p>
        ) : (
          <div id={hintId}>
            <InlineError title="Couldn’t read the person ships" description={`${readFailure.message}. Try again to pick another owner.`} onRetry={readFailure.onRetry} />
          </div>
        )}
      </div>
      {error === undefined ? null : <InlineError title="Couldn’t change the owner" description={`${error} Nothing changed.`} />}
      <DialogFooter>
        <DialogClose render={<Button type="button" disabled={isPending} />}>Cancel</DialogClose>
        <Button type="submit" variant="primary" isLoading={isPending} disabled={!canChange} data-testid="change-owner-submit">
          {isPending ? 'Changing owner' : 'Change owner'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * Change a ship's owner (docs/design/ship-owners, "The Owner control on the
 * ship page"): the fleet's active person ships, the current owner marked,
 * then argo apart, the fallback no person answers for. The dialog is the
 * confirm (Q4): Change owner stays off until another owner is picked; a
 * refusal shows the fleet's reason and that nothing changed. Desktop: a
 * dialog; phone: full screen.
 */
export function ChangeOwnerDialog(props: ChangeOwnerDialogProps) {
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
      <DialogContent data-testid="change-owner-dialog" className={dialogSurface.phoneFullScreen}>
        <ChangeOwnerDialogBody {...props} />
      </DialogContent>
    </Dialog>
  );
}
