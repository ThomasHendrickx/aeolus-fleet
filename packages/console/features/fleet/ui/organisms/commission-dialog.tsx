'use client';

import type { CrewSettings, ShipId } from '@aeolus-fleet/common';
import { isShipHandle } from '@aeolus-fleet/common/rules';
import { CircleCheck, CircleX, X } from 'lucide-react';
import { useId, useState } from 'react';

import { Button, classNames, Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, dialogSurface, DialogTitle, Input, Label, Switch, InlineError } from '@aeolus-fleet/ui';
import { useConsoleConstants } from '../../../../lib/console-constants';
import { promptBytes, settingsOf, withDefaultsFilled, workspaceProblems, type CrewSettingsValues, type HarnessOffer } from '../../../../lib/crew-settings-form';
import type { MachineLabelsInput } from '../../../../lib/machine-labels';
import type { SettingsCheck } from '../../../../lib/trierarch-plugin-schemas';
import { asHandle, checkShipName } from '../../../../lib/ship-name';
import { PermissionChoices } from '../../../../components/molecules/permission-choices';
import { Combobox } from '../../../../components/atoms/combobox';
import { Textarea } from '../../../../components/atoms/textarea';
import { CrewSettingsFields } from '../../../../components/molecules/crew-settings-fields';
import { LimitNotice } from '../../../../components/molecules/limit-notice';
import { shipLimitNotice } from '../../../../lib/limits';

/** The scopes offered under one heading: the fleet scopes, or one plugin's under its ship's name, each with the fleet's description. */
interface OfferedScopes {
  title: string;
  /** The plugin's namespace; null for the fleet scopes. */
  namespace: string | null;
  scopes: readonly { scope: string; description: string }[];
}

interface CommissionDialogProps {
  /** The types the fleet's active ships have, suggested for Type. */
  types: readonly string[];
  /**
   * What the fleet holds of what is typed, as the container reads it for
   * `onTypedChange`: the names an active ship has, and how many active ships
   * have each type. A name or type not in them is not read yet, or is free.
   */
  taken: { names: readonly string[]; typeShipCounts: ReadonlyMap<string, number> };
  /** The name and type as typed, so the container reads whether the name is taken and how many ships have the type. */
  onTypedChange?: (typed: { name: string; type: string }) => void;
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
   * With the trierarch plugin connected: what the machines offer, the fleet's
   * squadrons, and the plugin's check of the settings as the form makes them;
   * Request a crew starts on when a computer can crew. Without it, it starts off and
   * puts the ship on Needs crew, to crew by hand.
   */
  crewRequest?: {
    offers: readonly HarnessOffer[];
    squadrons?: readonly string[];
    /** The fleet's labels and machines, for the request's machine labels (#357); the field waits for them. */
    machineLabels?: MachineLabelsInput;
    check?: SettingsCheck;
    onSettingsChange: (settings: CrewSettings | undefined) => void;
  };
  /**
   * Signed in as argo: the person ships that may own the new ship, undefined
   * while they are read, and the one argo named last, preselected. Signed in as
   * an account there is no Owner field: its person ship owns the ship (decision 0045).
   */
  owner?: {
    choices: readonly { id: ShipId; name: string }[] | undefined;
    lastPicked?: ShipId;
    /** Each change of the text typed in the field, so the person ships that match are read. */
    onQueryChange?: (query: string) => void;
    /** A read of the person ships failed: why, and how to read again. */
    failure?: { message: string; onRetry: () => void };
  };
  /** What commissioning may grant, as the fleet describes it (decision 0046); undefined while it is read. */
  scopeGroups?: readonly OfferedScopes[];
  /** The ship, and the crew request to write once it is commissioned: none when Request a crew is off. */
  onSubmit: (ship: { name: string; type: string; note?: string; scopes?: string[]; owner?: ShipId }, request: { settings: CrewSettings | Record<string, never> } | undefined) => void | Promise<void>;
}

/** The open dialog's fields: they start empty each time it opens. */
function CommissionDialogBody({ types, taken, onTypedChange, isPending: isRequestPending, error, shipLimit, accountUrl, crewRequest, owner, scopeGroups, onSubmit }: Omit<CommissionDialogProps, 'isOpen' | 'onOpenChange'>) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string>();
  const isPending = isRequestPending || isSubmitting;
  const constants = useConsoleConstants();
  const { shipHandleMaxLength, firstPromptMaxBytes } = constants;
  const nameId = useId();
  const nameStatusId = useId();
  const typeId = useId();
  const typeHintId = useId();
  const noteId = useId();
  const ownerId = useId();
  const ownerHintId = useId();
  const crewId = useId();
  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [note, setNote] = useState('');
  // Undefined until the operator picks: the last pick, read after the dialog opens, shows until then.
  const [pickedOwner, setPickedOwner] = useState<{ id: ShipId; name: string } | null | undefined>(undefined);
  const ownerShipId = pickedOwner === undefined ? owner?.lastPicked : (pickedOwner?.id ?? undefined);
  // What argo picked stays offered when a later search no longer finds it.
  const ownerChoices = owner?.choices === undefined && pickedOwner == null ? undefined : [...(owner?.choices ?? []), ...(pickedOwner == null || owner?.choices?.some((choice) => choice.id === pickedOwner.id) === true ? [] : [pickedOwner])];
  const [grantedScopes, setGrantedScopes] = useState<readonly string[]>([]);
  // The first available offers set the default; an explicit choice stays switchable and is kept.
  const [isCrewRequestPicked, setIsCrewRequested] = useState<boolean>();
  const canComputerCrew = (crewRequest?.offers.length ?? 0) > 0 && crewRequest?.check?.kind !== 'noRoom';
  const isCrewRequested = isCrewRequestPicked ?? canComputerCrew;
  const [isExtraOpen, setIsExtraOpen] = useState(false);
  const [permissionQuery, setPermissionQuery] = useState('');
  const [editedCrewValues, setCrewValues] = useState<CrewSettingsValues>();
  const offers = crewRequest?.offers ?? [];
  const crewValues = withDefaultsFilled(editedCrewValues, offers);
  const isWaitingForMachine = crewValues.machineLabels.length > 0 && crewRequest?.machineLabels?.matchOf(crewValues.machineLabels).matching.length === 0;
  const crewSettings = settingsOf(crewValues);
  const refusal = crewRequest?.check?.kind === 'refused' ? crewRequest.check : undefined;
  const workspaceNote = workspaceProblems(crewValues.workspace, crewRequest?.offers.find((offer) => offer.harness === crewValues.harness)).note;
  const isCrewReady =
    !isCrewRequested ||
    crewRequest === undefined ||
    (crewSettings !== undefined && refusal === undefined && workspaceNote === undefined && promptBytes(crewValues.firstPrompt) <= firstPromptMaxBytes);
  const check = checkShipName(name, { activeNames: taken.names });
  const isNameProblem = check.kind === 'invalid' || check.kind === 'reserved' || check.kind === 'taken';
  const trimmedType = type.trim();
  const isTypeValid = isShipHandle(trimmedType);
  const isTypeProblem = trimmedType !== '' && !isTypeValid;
  const isOwnerReady = owner === undefined || ownerShipId !== undefined;
  const canCommission = check.kind === 'available' && isTypeValid && shipLimit === undefined && isCrewReady && isOwnerReady;
  const missing = [check.kind === 'available' ? null : 'name', isTypeValid ? null : 'type', isOwnerReady ? null : 'owner', isCrewReady ? null : 'crew settings'].filter((item) => item !== null);
  const missingRequirements = shipLimit !== undefined ? 'The fleet is at its ship limit.' : missing.length === 2 && missing[0] === 'name' && missing[1] === 'type' ? 'Enter a name and type.' : missing.length === 2 && missing[0] === 'owner' && missing[1] === 'crew settings' ? 'Pick an owner and complete crew settings.' : `Complete ${missing.join(', ')}.`;
  const missingHelp = missing.length === 2 && missing[0] === 'name' && missing[1] === 'type' && shipLimit === undefined ? 'Complete the two fields above to commission this ship.' : shipLimit !== undefined ? 'View the limits or retire a ship before commissioning another.' : [check.kind === 'available' ? null : name === '' ? 'Enter a free ship name.' : check.message, isTypeValid ? null : 'Enter a type.', isOwnerReady ? null : owner.choices?.length === 0 ? 'Commission the person’s ship first.' : 'Pick the person who answers for this ship.', isCrewReady ? null : crewRequest.offers.length === 0 ? 'Connect a computer offering a harness, or turn off Request a crew.' : workspaceNote ?? 'Complete the crew settings, or turn off Request a crew.'].filter((item) => item !== null).join(' ');
  const hasCrewSettings = crewRequest !== undefined && isCrewRequested;

  return (
    <form
      noValidate
      data-testid="commission-form"
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        void (async () => {
        if (canCommission && !isPending) {
          setIsSubmitting(true);
          setSubmitError(undefined);
          const ship = {
            name,
            type: trimmedType,
            ...(note.trim() === '' ? {} : { note }),
            ...(grantedScopes.length === 0 ? {} : { scopes: [...grantedScopes] }),
            ...(owner === undefined || ownerShipId === undefined ? {} : { owner: ownerShipId }),
          };
          // Without the trierarch plugin a request holds no settings: the ship waits on Needs crew, crewed by hand.
          try {
            await onSubmit(ship, !isCrewRequested ? undefined : crewRequest === undefined ? { settings: {} } : crewSettings === undefined ? undefined : { settings: crewSettings });
          } catch (failure) {
            setSubmitError(failure instanceof Error ? failure.message : 'Couldn’t commission the ship. Nothing you typed is lost. Try again.');
          } finally {
            setIsSubmitting(false);
          }
        }
        })();
      }}
    >
      <DialogClose render={<Button type="button" variant="ghost" size="sm" isIconOnly className="absolute right-3 top-3" aria-label="Close commission form" disabled={isPending} />}><X aria-hidden /></DialogClose>
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
            placeholder="e.g. reviewer-02"
            data-testid="commission-name"
            aria-invalid={isNameProblem ? true : undefined}
            aria-describedby={nameStatusId}
            className="pr-9 max-sm:h-(--size-control-touch) max-sm:text-input-touch"
            value={name}
            onChange={(event) => {
              setName(asHandle(event.target.value));
              onTypedChange?.({ name: asHandle(event.target.value), type: trimmedType });
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
          {check.kind === 'empty' ? `1 to ${String(shipHandleMaxLength)} lowercase letters, digits, hyphens or colons.` : check.message}
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
            onTypedChange?.({ name, type: (value ?? '').trim() });
          }}
          isFreeText
          toQuery={asHandle}
          placeholder="e.g. reviewer"
          isInvalid={isTypeProblem}
          aria-describedby={typeHintId}
          data-testid="commission-type"
        />
        <p id={typeHintId} className={classNames('text-meta', isTypeProblem ? 'text-destructive-text' : 'text-muted-foreground')}>
          {isTypeProblem
            ? `Use 1 to ${String(shipHandleMaxLength)} lowercase letters, digits, hyphens or colons.`
            : taken.typeShipCounts.get(trimmedType) === undefined || trimmedType === '' ? 'Ships of the same type share a type address.' : `${String(taken.typeShipCounts.get(trimmedType))} active ships have this type.`}
        </p>
      </div>
      {owner === undefined ? null : (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ownerId}>Owner</Label>
          <Combobox
            id={ownerId}
            options={(ownerChoices ?? []).map((choice) => ({ value: choice.id, label: choice.name }))}
            value={ownerShipId ?? null}
            onValueChange={(value) => {
              setPickedOwner(ownerChoices?.find((choice) => choice.id === value) ?? null);
            }}
            {...(owner.onQueryChange === undefined ? {} : { onQueryChange: owner.onQueryChange })}
            groupLabel="Person ships"
            emptyText={(query) => `No person ship is named ${query}.`}
            placeholder={owner.failure !== undefined && owner.choices === undefined ? 'Person ships not read' : owner.choices === undefined ? 'Reading the person ships' : owner.choices.length === 0 ? 'No person ship yet' : 'Pick a person ship'}
            aria-describedby={ownerHintId}
            data-testid="commission-owner"
          />
          {owner.failure === undefined ? (
            <p id={ownerHintId} className="text-meta text-muted-foreground">
              {owner.choices?.length === 0
                ? 'A ship needs a person to answer for it. Commission that person\'s ship first.'
                : 'Its questions, gates and trouble go to this person’s ship.'}
            </p>
          ) : (
            <div id={ownerHintId}>
              <InlineError
                title="Couldn’t read the person ships"
                description={`${owner.failure.message}. Nothing you typed is lost; try again to pick an owner.`}
                onRetry={owner.failure.onRetry}
              />
            </div>
          )}
        </div>
      )}
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
      <section className="flex flex-col gap-1.5" aria-label="Permissions">
        <h3 className="text-body font-semibold">Permissions</h3>
        <p className="text-meta text-muted-foreground">Every ship sends and receives messages.</p>
        <button type="button" className="flex items-center justify-between text-left text-body font-medium" aria-expanded={isExtraOpen} disabled={isPending} onClick={() => { setIsExtraOpen(!isExtraOpen); }} data-testid="commission-extra-permissions">
          <span><span aria-hidden>{isExtraOpen ? '⌄' : '›'} </span><span>Extra permissions</span></span>
          {grantedScopes.length === 0 ? null : <span className="text-meta text-muted-foreground">{grantedScopes.length} selected</span>}
        </button>
        {!isExtraOpen ? null : scopeGroups === undefined ? <p className="animate-pulse text-meta text-muted-foreground" data-testid="commission-scopes-reading">Reading the fleet&apos;s scopes.</p> : <>
          <PermissionChoices choices={scopeGroups.flatMap((group) => group.scopes).filter(({ scope }) => scope !== 'messages:send' && scope !== 'messages:receive')} picked={grantedScopes} onPick={setGrantedScopes} query={permissionQuery} onQueryChange={setPermissionQuery} isDisabled={isPending} />
          <p className="text-meta text-muted-foreground">Each choice grants one permission.</p>
        </>}
      </section>
      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={crewId}>Request a crew</Label>
          <Switch id={crewId} checked={isCrewRequested} onCheckedChange={setIsCrewRequested} disabled={isPending} data-testid="commission-request-crew" />
        </div>
        <p className="-mt-2 text-meta text-muted-foreground">
          {crewRequest === undefined
            ? `Puts ${name === '' ? 'the ship' : name} on your Needs crew list until you crew it by hand. You get its starting prompt next either way.`
            : !canComputerCrew
              ? isCrewRequested ? 'No computer can crew this ship right now. Turn this off to get the starting prompt.' : 'No computer can crew this ship right now. You get the starting prompt next. You can still request a crew.'
              : 'The trierarch plugin picks a trierarch that starts the session and keeps it crewed.'}
        </p>
        {hasCrewSettings ? (
          <CrewSettingsFields
            isCommission
            shipName={name.trim() === '' ? 'this ship' : name.trim()}
            offers={crewRequest.offers}
            values={crewValues}
            firstPromptMaxBytes={firstPromptMaxBytes}
            onChange={(next) => {
              setCrewValues(next);
              crewRequest.onSettingsChange(settingsOf(next));
            }}
            squadrons={crewRequest.squadrons}
            refusal={refusal}
            isDisabled={isPending}
            {...(crewRequest.machineLabels === undefined ? {} : { machineLabels: crewRequest.machineLabels })}
          />
        ) : null}
      </div>
      {(submitError ?? error) === undefined ? null : <InlineError title="Not commissioned" description={submitError ?? error ?? ''} />}
      {isWaitingForMachine ? <p className="text-meta text-muted-foreground" data-testid="commission-crew-note">The request will wait for a machine with these labels.</p> : null}
      <DialogFooter className="items-center max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-10 max-sm:flex-col max-sm:items-stretch max-sm:border-t max-sm:border-border max-sm:bg-popover max-sm:p-4 max-sm:[&_button]:w-full max-sm:[&_button]:h-(--size-control-touch)">
        {!canCommission ? <div className="mr-auto flex min-w-0 flex-1 flex-col gap-1 text-meta max-sm:order-first max-sm:mb-2" role="status" data-testid="commission-disabled-reason">
          <span>{missingRequirements}</span>
          <span className="text-muted-foreground">{missingHelp}</span>
        </div> : !isCrewRequested ? null : <span className="mr-auto text-meta text-muted-foreground" >{isWaitingForMachine ? 'The request will wait for a machine with these labels.' : crewRequest?.check?.kind === 'noRoom' ? 'The request will wait for room.' : 'Turn off Request a crew to get the starting prompt instead.'}</span>}
        <DialogClose render={<Button type="button" className="max-sm:order-last" disabled={isPending} />}>Cancel</DialogClose>
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
 * with it, the crew request's settings, checked by the plugin. Signed in as
 * argo, the Owner, a person ship, the last pick preselected
 * (docs/design/ship-owners). The button
 * stays disabled until the name is free, the type a handle and, for argo, an owner picked. Desktop: a
 * dialog; phone: full screen. On success the page hands over to the
 * StartingPromptDialog.
 */
export function CommissionDialog(props: CommissionDialogProps) {
  const { isOpen, onOpenChange, isPending } = props;
  const [isSubmitting, setIsSubmitting] = useState(false);
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(isNowOpen) => {
        if (!isPending && !isSubmitting) {
          onOpenChange(isNowOpen);
        }
      }}
    >
      <DialogContent size="md" data-testid="commission-dialog" className={`${dialogSurface.phoneFullScreen} max-sm:pb-60 max-sm:max-h-dvh`}>
        <CommissionDialogBody {...props} onSubmit={async (ship, request) => {
          setIsSubmitting(true);
          try { await props.onSubmit(ship, request); } finally { setIsSubmitting(false); }
        }} />
      </DialogContent>
    </Dialog>
  );
}
