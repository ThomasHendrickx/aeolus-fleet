'use client';

import type { FleetId } from '@aeolus-fleet/common';
import { useId, useState } from 'react';

import { Button, Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, dialogSurface } from '@aeolus-fleet/ui';
import { Input } from '../../../../components/atoms/input';
import { Label } from '../../../../components/atoms/label';
import { Textarea } from '../../../../components/atoms/textarea';
import type { SealingRefusal } from '../../services/sealing-refusal';
import { KeyCondition } from '../molecules/key-condition';
import { SealingRefusalError } from '../molecules/sealing-refusal-error';

interface TurnOnSealingDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  fleetId: FleetId;
  /** The KMS is being checked: the button says so and cannot be pressed twice. */
  isPending: boolean;
  /** Why the server refused it; the dialog stays open with the input kept. */
  refusal?: SealingRefusal;
  onTurnOn: (input: { companyKey: string; recoveryKey?: string }) => void;
}

/** The form: the company key, an optional recovery key, and what turning on means. */
function TurnOnForm({ fleetId, isPending, refusal, onTurnOn }: Omit<TurnOnSealingDialogProps, 'isOpen' | 'onOpenChange'>) {
  const companyKeyId = useId();
  const companyKeyHelpId = useId();
  const recoveryKeyId = useId();
  const recoveryKeyHelpId = useId();
  const [companyKey, setCompanyKey] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const canSubmit = companyKey.trim() !== '' && !isPending;

  return (
    <form
      noValidate
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) {
          const recovery = recoveryKey.trim();
          onTurnOn(recovery === '' ? { companyKey: companyKey.trim() } : { companyKey: companyKey.trim(), recoveryKey: recovery });
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>Turn on sealing</DialogTitle>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={companyKeyId}>Company key</Label>
        <Textarea
          id={companyKeyId}
          isMono
          rows={2}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="arn:aws:kms:eu-central-1:111122223333:key/…"
          data-testid="turn-on-sealing-company-key"
          aria-describedby={companyKeyHelpId}
          className="max-sm:text-input-touch"
          value={companyKey}
          onChange={(event) => {
            setCompanyKey(event.target.value);
          }}
        />
        <KeyCondition fleetId={fleetId} id={companyKeyHelpId} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={recoveryKeyId}>
          Recovery key <span className="font-normal text-muted-foreground">optional</span>
        </Label>
        <Input
          id={recoveryKeyId}
          isMono
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="age1…"
          data-testid="turn-on-sealing-recovery-key"
          aria-describedby={recoveryKeyHelpId}
          className="max-sm:h-(--size-control-touch) max-sm:text-input-touch"
          value={recoveryKey}
          onChange={(event) => {
            setRecoveryKey(event.target.value);
          }}
        />
        <p id={recoveryKeyHelpId} className="text-meta text-muted-foreground">
          The public half of an age key you keep offline. Once set it can be replaced, never removed.
        </p>
      </div>
      <ul className="list-disc pl-5 text-meta text-foreground">
        <li>Sealing can’t be turned off.</li>
        <li>Payloads stored before are sealed in the background.</li>
      </ul>
      {refusal === undefined ? null : <SealingRefusalError refusal={refusal} fleetId={fleetId} failed="Couldn’t turn on sealing" />}
      <DialogFooter>
        <DialogClose render={<Button type="button" disabled={isPending} />}>Cancel</DialogClose>
        <Button type="submit" variant="primary" isLoading={isPending} disabled={!canSubmit} data-testid="turn-on-sealing-submit">
          {isPending ? 'Checking the key…' : 'Turn on sealing'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * Turn on sealing (sealing page mockup; decision 0068, B4): the company key
 * by its reference, whose policy must name this fleet by the condition shown
 * to copy (ES4), and an optional recovery key. While the KMS is checked the
 * button is busy and the dialog stays open; a refusal shows inline with the
 * input kept, saying nothing changed. Full screen on phone.
 */
export function TurnOnSealingDialog({ isOpen, onOpenChange, ...form }: TurnOnSealingDialogProps) {
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(isOpening) => {
        // Escape or an outside click while the KMS is checked would hide the answer.
        if (!form.isPending) {
          onOpenChange(isOpening);
        }
      }}
    >
      <DialogContent size="md" data-testid="turn-on-sealing-dialog" className={dialogSurface.phoneFullScreen}>
        {isOpen ? <TurnOnForm {...form} /> : null}
      </DialogContent>
    </Dialog>
  );
}
