'use client';

import { FLEET_SCOPES, SHIP_HANDLE_MAX_LENGTH, shipHandleSchema, type CrewSettings, type FleetScope, type ListedShip } from '@aeolus-fleet/common';
import { CircleCheck, CircleX, Tag } from 'lucide-react';
import { useId, useState } from 'react';

import { classNames } from '../../lib/class-names';
import { defaultValues, FIRST_PROMPT_MAX_BYTES, promptBytes, settingsOf, type CrewSettingsValues, type HarnessOffer } from '../../lib/crew-settings-form';
import type { SettingsCheck } from '../../lib/trierarch-plugin';
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
import { Switch } from '../atoms/switch';
import { Textarea } from '../atoms/textarea';
import { CrewSettingsFields } from '../molecules/crew-settings-fields';
import { InlineError } from '../molecules/inline-error';
import { LimitNotice } from '../molecules/limit-notice';
import { shipLimitNotice } from '../../lib/limits';

interface CommissionDialogProps {
  /** The fleet's active ships: their names are taken, their types suggested. */
  activeShips: readonly ListedShip[];
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  isPending: boolean;
  /** Why the last try failed; the dialog stays open with the input kept. */
  error?: string;
  /** The ship limit the fleet is at: the dialog says so, and commissions nothing (canvas 12.1). */
  shipLimit?: number;
  /** Where the hosted account lists the limits, for View limits. */
  accountUrl?: string;
  /**
   * With the trierarch plugin on: what the machines offer, the fleet's
   * squadrons, and the plugin's check of the settings as the form makes them.
   * Without it, Request a crew puts the ship on Needs crew, to crew by hand.
   */
  crewRequest?: {
    offers: readonly HarnessOffer[];
    squadrons?: readonly string[];
    check?: SettingsCheck;
    onSettingsChange: (settings: CrewSettings | undefined) => void;
  };
  /** The ship, and the crew request to write once it is commissioned: none when Request a crew is off. */
  onSubmit: (ship: { name: string; type: string; note?: string; fleetScopes?: FleetScope[] }, request: { settings: CrewSettings | Record<string, never> } | undefined) => void;
}

/** What each fleet scope lets a ship's session do, beside its name. */
const FLEET_SCOPE_WORDS: Record<FleetScope, string> = {
  'fleet:read': 'Read the fleet',
  'fleet:manage': 'Manage the fleet',
  'crew:assign': 'Assign crews',
  'crew:run': 'Run crews',
};

/** The open dialog's fields: they start empty each time it opens. */
function CommissionDialogBody({ activeShips, isPending, error, shipLimit, accountUrl, crewRequest, onSubmit }: Omit<CommissionDialogProps, 'isOpen' | 'onOpenChange'>) {
  const nameId = useId();
  const nameStatusId = useId();
  const typeId = useId();
  const typeHintId = useId();
  const noteId = useId();
  const crewId = useId();
  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [note, setNote] = useState('');
  const [fleetScopes, setFleetScopes] = useState<readonly FleetScope[]>([]);
  // On by default, as the canvas draws it (CrCommission, CrCommissionOff).
  const [isCrewRequested, setIsCrewRequested] = useState(true);
  const [crewValues, setCrewValues] = useState<CrewSettingsValues>(() => defaultValues(crewRequest?.offers ?? []));
  const crewSettings = settingsOf(crewValues);
  const refusal = crewRequest?.check?.kind === 'refused' ? crewRequest.check : undefined;
  const isCrewReady =
    !isCrewRequested || crewRequest === undefined || (crewSettings !== undefined && refusal === undefined && promptBytes(crewValues.firstPrompt) <= FIRST_PROMPT_MAX_BYTES);
  const check = checkShipName(name, { activeNames: activeShips.map((ship) => ship.name) });
  const isNameProblem = check.kind === 'invalid' || check.kind === 'reserved' || check.kind === 'taken';
  const trimmedType = type.trim();
  const isTypeValid = shipHandleSchema.safeParse(trimmedType).success;
  const isTypeProblem = trimmedType !== '' && !isTypeValid;
  const types = [...new Set(activeShips.map((ship) => ship.type))].sort();
  const canCommission = check.kind === 'available' && isTypeValid && shipLimit === undefined && isCrewReady;
  const hasCrewSettings = crewRequest !== undefined && isCrewRequested;

  return (
    <form
      noValidate
      data-testid="commission-form"
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        if (canCommission) {
          const ship = {
            name,
            type: trimmedType,
            ...(note.trim() === '' ? {} : { note }),
            ...(fleetScopes.length === 0 ? {} : { fleetScopes: [...fleetScopes] }),
          };
          // Without the trierarch plugin a request holds no settings: the ship waits on Needs crew, crewed by hand.
          onSubmit(ship, !isCrewRequested ? undefined : crewRequest === undefined ? { settings: {} } : crewSettings === undefined ? undefined : { settings: crewSettings });
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>Commission a ship</DialogTitle>
        <DialogDescription>
          {hasCrewSettings
            ? 'A durable identity with its own inbox, and a crew request so it gets a session right away.'
            : 'A ship is a durable agent identity with its own inbox. Next, you get the starting prompt.'}
        </DialogDescription>
      </DialogHeader>
      {shipLimit === undefined ? null : <LimitNotice {...shipLimitNotice(shipLimit)} accountUrl={accountUrl} testId="commission-ship-limit" />}
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
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-body font-medium text-foreground">Fleet access</legend>
        {FLEET_SCOPES.map((scope) => (
          <label key={scope} className="flex items-center justify-between gap-3 text-body text-foreground">
            <span>
              {FLEET_SCOPE_WORDS[scope]} <span className="font-mono text-id text-muted-foreground">{scope}</span>
            </span>
            <Switch
              checked={fleetScopes.includes(scope)}
              onCheckedChange={(isChecked) => {
                setFleetScopes((held) => (isChecked ? [...held, scope] : held.filter((each) => each !== scope)));
              }}
              data-testid={`commission-${scope.replace(':', '-')}`}
            />
          </label>
        ))}
        <p className="text-meta text-muted-foreground">Every ship sends and receives. Fleet access lets its session act as the console does; crew ships lets a trierarch start their sessions. It cannot be changed later.</p>
      </fieldset>
      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={crewId}>Request a crew</Label>
          <Switch id={crewId} checked={isCrewRequested} onCheckedChange={setIsCrewRequested} data-testid="commission-request-crew" />
        </div>
        <p className="-mt-2 text-meta text-muted-foreground">
          {crewRequest === undefined
            ? `Puts ${name === '' ? 'the ship' : name} on your Needs crew list until you crew it by hand. You get its starting prompt next either way.`
            : 'The trierarch plugin picks a trierarch that starts the session and keeps it crewed.'}
        </p>
        {hasCrewSettings ? (
          <CrewSettingsFields
            offers={crewRequest.offers}
            values={crewValues}
            onChange={(next) => {
              setCrewValues(next);
              crewRequest.onSettingsChange(settingsOf(next));
            }}
            squadrons={crewRequest.squadrons}
            refusal={refusal}
            isDisabled={isPending}
          />
        ) : null}
      </div>
      {error === undefined ? null : <InlineError title="Not commissioned" description={error} />}
      <DialogFooter className="items-center">
        {crewRequest === undefined ? null : (
          <span className="mr-auto text-meta text-muted-foreground" data-testid="commission-crew-note">
            {!isCrewRequested ? null : crewRequest.check?.kind === 'noRoom' ? 'The request will wait for room.' : 'Uncheck Request a crew to get the starting prompt instead.'}
          </span>
        )}
        <DialogClose render={<Button type="button" disabled={isPending} />}>Cancel</DialogClose>
        <Button type="submit" variant="primary" isLoading={isPending} disabled={!canCommission} data-testid="commission-submit">
          {isPending ? 'Commissioning' : hasCrewSettings ? 'Commission and request crew' : 'Commission ship'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * Step 1 of commissioning (docs/design/png/CommissionForm.png): the name,
 * checked as the operator types (the rule, a counter, and one status line
 * that says available or why not), the type with suggestions from the fleet
 * and what it means, and the optional note the blueprint keeps, and Request a
 * crew (#245): without the trierarch plugin it puts the ship on Needs crew;
 * with it, the crew request's settings, checked by the plugin. The button
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
