'use client';

import type { FleetId } from '@aeolus-fleet/common';
import { useId, useState } from 'react';

import { Button, Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, dialogSurface } from '@aeolus-fleet/ui';
import { Label } from '../../../../components/atoms/label';
import { Textarea } from '../../../../components/atoms/textarea';
import type { SealingRefusal } from '../../services/sealing-refusal';
import { shortCompanyKey } from '../../services/sealing-view';
import { KeyCondition } from '../molecules/key-condition';
import { SealingRefusalError } from '../molecules/sealing-refusal-error';

interface ChangeCompanyKeyDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  fleetId: FleetId;
  /** The company key every data key is wrapped by now. */
  current: string;
  isPending: boolean;
  /** Why the server refused it; the dialog stays open with the input kept. */
  refusal?: SealingRefusal;
  onChange: (input: { companyKey: string }) => void;
}

function ChangeForm({ fleetId, current, isPending, refusal, onChange }: Omit<ChangeCompanyKeyDialogProps, 'isOpen' | 'onOpenChange'>) {
  const companyKeyId = useId();
  const companyKeyHelpId = useId();
  const [companyKey, setCompanyKey] = useState('');
  const canSubmit = companyKey.trim() !== '' && companyKey.trim() !== current && !isPending;

  return (
    <form
      noValidate
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) {
          onChange({ companyKey: companyKey.trim() });
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>Change company key</DialogTitle>
      </DialogHeader>
      <div className="flex flex-col gap-1">
        <p className="text-meta font-medium">Current</p>
        <p className="font-mono text-id text-muted-foreground" title={current}>
          {shortCompanyKey(current)}
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={companyKeyId}>New company key</Label>
        <Textarea
          id={companyKeyId}
          isMono
          rows={2}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="arn:aws:kms:eu-central-1:111122223333:key/…"
          data-testid="change-company-key-input"
          aria-describedby={companyKeyHelpId}
          className="max-sm:text-input-touch"
          value={companyKey}
          onChange={(event) => {
            setCompanyKey(event.target.value);
          }}
        />
        <KeyCondition fleetId={fleetId} id={companyKeyHelpId} />
      </div>
      <ul className="list-disc pl-5 text-meta text-foreground">
        <li>Every data key moves to the new key. No payload is sealed again.</li>
        <li>The current key must stay reachable until this is done.</li>
      </ul>
      {refusal === undefined ? null : <SealingRefusalError refusal={refusal} fleetId={fleetId} failed="Couldn’t change the company key" />}
      <DialogFooter>
        <DialogClose render={<Button type="button" disabled={isPending} />}>Cancel</DialogClose>
        <Button type="submit" variant="primary" isLoading={isPending} disabled={!canSubmit} data-testid="change-company-key-submit">
          {isPending ? 'Moving the data keys…' : 'Change company key'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * Change company key (sealing page mockup; decision 0068, B13c): the new key,
 * checked as turning on checks one, gets every data key from the current
 * one, which must stay reachable; a current key not reachable is refused,
 * pointing to recovery. A refusal shows inline with the input kept.
 */
export function ChangeCompanyKeyDialog({ isOpen, onOpenChange, ...form }: ChangeCompanyKeyDialogProps) {
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(isOpening) => {
        if (!form.isPending) {
          onOpenChange(isOpening);
        }
      }}
    >
      <DialogContent size="md" data-testid="change-company-key-dialog" className={dialogSurface.phoneFullScreen}>
        {isOpen ? <ChangeForm {...form} /> : null}
      </DialogContent>
    </Dialog>
  );
}
