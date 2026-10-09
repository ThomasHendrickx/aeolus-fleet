'use client';

import type { CrewSettings } from '@aeolus-fleet/common';
import { CircleX, Clock, LoaderCircle, RotateCw, ShipWheel } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { useConsoleConstants } from '../../lib/console-constants';
import { defaultValues, promptBytes, settingsOf, valuesOf, type CrewSettingsValues, type HarnessOffer } from '../../lib/crew-settings-form';
import type { MachineLabelsInput } from '../../lib/machine-labels';
import { secondsTime } from '../../lib/relative-time';
import type { SettingsCheck } from '../../lib/trierarch-plugin-schemas';
import { Button } from '../atoms/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../atoms/dialog';
import { dialogSurface } from '../atoms/dialog-surface';
import { CrewSettingsFields } from '../molecules/crew-settings-fields';
import { InlineError } from '../molecules/inline-error';

/** loading: the machines are being read; unreachable: the trierarch plugin does not answer; ready: the form. */
export type RequestCrewDialogState = 'loading' | 'unreachable' | 'ready';

interface RequestCrewDialogProps {
  shipName: string;
  /** Request a crew, or Edit the settings of the request held (decision 3). */
  mode: 'request' | 'edit';
  state: RequestCrewDialogState;
  offers: readonly HarnessOffer[];
  /** The settings the request holds, for Edit. */
  heldSettings?: CrewSettings | null;
  /** The fleet's squadrons, when squadrons is on. */
  squadrons?: readonly string[];
  /** The fleet's labels and machines, for the request's machine labels; the field waits for them. */
  machineLabels?: MachineLabelsInput;
  /** The trierarch plugin's check of the settings as the form makes them now. */
  check?: SettingsCheck;
  /** When the last request was refused by the check made at that moment: nothing was requested. */
  refusedAt?: Date;
  /** Why the last request failed otherwise; nothing changed. */
  error?: string;
  isPending: boolean;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** The settings the form makes, as they change, for the check. */
  onSettingsChange: (settings: CrewSettings | undefined) => void;
  onSubmit: (settings: CrewSettings) => void;
  onRetry: () => void;
}

const WORDS = {
  request: {
    title: (shipName: string) => `Request a crew for ${shipName}`,
    description: 'The trierarch plugin picks a trierarch, which starts the session and keeps it crewed.',
    action: 'Request crew',
    busy: 'Requesting',
  },
  edit: {
    title: (shipName: string) => `Edit the crew request for ${shipName}`,
    description: 'Saving writes a new version of the settings: its trierarch stops the session and starts it again with them, in the same workspace.',
    action: 'Save and restart',
    busy: 'Saving',
  },
} as const;

const TONES = {
  waiting: 'border-tone-waiting-border bg-tone-waiting-bg text-tone-waiting-fg',
  attention: 'border-tone-attention-border bg-tone-attention-bg text-tone-attention-fg',
  note: 'border-border bg-muted text-muted-foreground',
} as const;

function Banner({ tone, icon, children }: { tone: keyof typeof TONES; icon: ReactNode; children: ReactNode }) {
  return (
    <div
      role={tone === 'attention' ? 'alert' : 'status'}
      data-testid="request-crew-banner"
      className={`flex items-start gap-2 rounded-lg border px-3.5 py-2.5 text-meta [&_svg]:mt-0.5 [&_svg]:size-(--size-icon-sm) [&_svg]:shrink-0 ${TONES[tone]}`}
    >
      {icon}
      <span>{children}</span>
    </div>
  );
}

/** The open dialog's form: it starts from the held settings, or the defaults, each time it opens. */
function RequestCrewForm(props: Omit<RequestCrewDialogProps, 'isOpen' | 'onOpenChange'>) {
  const { firstPromptMaxBytes } = useConsoleConstants();
  const { shipName, mode, offers, heldSettings, squadrons, machineLabels, check, refusedAt, error, isPending, onSettingsChange, onSubmit } = props;
  const words = WORDS[mode];
  const [values, setValues] = useState<CrewSettingsValues>(() => (mode === 'edit' ? valuesOf(heldSettings, offers) : defaultValues(offers)));
  const settings = settingsOf(values);
  const refusal = check?.kind === 'refused' ? check : undefined;
  const isPromptTooLong = promptBytes(values.firstPrompt) > firstPromptMaxBytes;
  const isWaitingForMachine = values.machineLabels.length > 0 && machineLabels?.matchOf(values.machineLabels).matching.length === 0;
  const canSubmit = settings !== undefined && refusal === undefined && !isPromptTooLong && !isPending;
  const change = (next: CrewSettingsValues) => {
    setValues(next);
    onSettingsChange(settingsOf(next));
  };

  return (
    <form
      noValidate
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) {
          onSubmit(settings);
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>{words.title(shipName)}</DialogTitle>
        <DialogDescription>{words.description}</DialogDescription>
      </DialogHeader>
      {offers.length === 0 ? (
        <Banner tone="waiting" icon={<ShipWheel aria-hidden />}>
          No machine answers with what it offers yet. Join a machine under Trierarchs, or wait for its trierarch to report.
        </Banner>
      ) : refusal !== undefined && refusedAt !== undefined ? (
        <Banner tone="attention" icon={<CircleX aria-hidden />}>
          The trierarch plugin refused: {refusal.field}. Nothing was requested. Change the field below and try again.
        </Banner>
      ) : check?.kind === 'noRoom' && !isWaitingForMachine ? (
        // No machine carrying the labels reads as no room to the plugin's check; the field says why instead.
        <Banner tone="waiting" icon={<Clock aria-hidden />}>
          No trierarch has a free slot right now. You can still request: the request waits on Needs crew and the plugin assigns a trierarch when a slot frees up.
        </Banner>
      ) : null}
      {offers.length === 0 ? null : <CrewSettingsFields
          offers={offers}
          values={values}
          firstPromptMaxBytes={firstPromptMaxBytes}
          onChange={change}
          squadrons={squadrons}
          refusal={refusal}
          isDisabled={isPending}
          {...(machineLabels === undefined ? {} : { machineLabels: { ...machineLabels, shipName } })}
        />}
      {error === undefined ? null : <InlineError title={mode === 'edit' ? 'Couldn’t save the settings' : 'Couldn’t request crew'} description={`${error} Nothing changed.`} />}
      <DialogFooter className="items-center">
        <span className="mr-auto text-meta text-muted-foreground" data-testid="request-crew-note">
          {refusal !== undefined && refusedAt !== undefined
            ? `Refused at ${secondsTime(refusedAt)}. Nothing was requested.`
            : isWaitingForMachine
              ? 'The request will wait for a machine with these labels.'
              : check?.kind === 'noRoom'
                ? 'The request will wait for room.'
                : null}
        </span>
        <DialogClose render={<Button type="button" disabled={isPending} />}>Cancel</DialogClose>
        <Button type="submit" variant="primary" icon={<ShipWheel />} isLoading={isPending} disabled={!canSubmit} data-testid="request-crew-submit">
          {isPending ? words.busy : words.action}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * Request a crew with settings, or edit the settings of the request held
 * (canvas CrRequestForm, CrRequestLoading, CrRequestNoRoom, CrRequestRefused,
 * CrRequestUnreachable; #245, S3). The form is built from what the machines
 * offer; the trierarch plugin checks the settings as they change and once
 * more when requesting. A refusal names the field and requests nothing; no
 * room still requests, and the request waits. Desktop: a dialog; phone: full
 * screen.
 */
export function RequestCrewDialog(props: RequestCrewDialogProps) {
  const { shipName, mode, state, isOpen, onOpenChange, isPending, onRetry } = props;
  const words = WORDS[mode];
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(isNowOpen) => {
        if (!isPending) {
          onOpenChange(isNowOpen);
        }
      }}
    >
      <DialogContent size="md" data-testid="request-crew-dialog" className={dialogSurface.phoneFullScreen}>
        {state === 'ready' ? (
          <RequestCrewForm {...props} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{words.title(shipName)}</DialogTitle>
              <DialogDescription>{words.description}</DialogDescription>
            </DialogHeader>
            {state === 'loading' ? (
              <Banner tone="note" icon={<LoaderCircle aria-hidden className="motion-safe:animate-spin" />}>
                Loading the trierarch plugin’s options.
              </Banner>
            ) : (
              <>
                <Banner tone="attention" icon={<CircleX aria-hidden />}>
                  The trierarch plugin is not answering. Its options can’t load, so a request with settings can’t be made now. Nothing changed.
                </Banner>
                <div>
                  <Button size="sm" icon={<RotateCw />} onClick={onRetry} data-testid="request-crew-retry">
                    Try again
                  </Button>
                </div>
                {mode === 'request' ? <p className="text-meta text-muted-foreground">You can still crew {shipName} by hand: close this and use Get starting prompt.</p> : null}
              </>
            )}
            <DialogFooter className="items-center">
              <span className="mr-auto text-meta text-muted-foreground">
                {state === 'loading' ? 'Waiting for the trierarch plugin.' : `${words.action} is off until the plugin answers.`}
              </span>
              <DialogClose render={<Button type="button" />}>Cancel</DialogClose>
              <Button type="button" variant="primary" icon={<ShipWheel />} disabled>
                {words.action}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
