'use client';

import type { FleetId } from '@aeolus-fleet/common';
import { useId, useState } from 'react';

import { Button, Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, dialogSurface } from '@aeolus-fleet/common/header';
import { Input } from '../../../../components/atoms/input';
import { Label } from '../../../../components/atoms/label';
import type { SealingRefusal } from '../../services/sealing-refusal';
import { shortened } from '../../services/sealing-view';
import { SealingRefusalError } from '../molecules/sealing-refusal-error';

interface RecoveryKeyDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  fleetId: FleetId;
  /** The fingerprint of the recovery key set now; none on a fleet sealed without one, which sets its first. */
  current: string | null;
  isPending: boolean;
  /** Why the server refused it; the dialog stays open with the input kept. */
  refusal?: SealingRefusal;
  onChange: (input: { recoveryKey: string }) => void;
}

function RecoveryKeyForm({ fleetId, current, isPending, refusal, onChange }: Omit<RecoveryKeyDialogProps, 'isOpen' | 'onOpenChange'>) {
  const recoveryKeyId = useId();
  const recoveryKeyHelpId = useId();
  const [recoveryKey, setRecoveryKey] = useState('');
  const canSubmit = recoveryKey.trim() !== '' && !isPending;
  const isReplacing = current !== null;
  const action = isReplacing ? 'Replace recovery key' : 'Set recovery key';

  return (
    <form
      noValidate
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) {
          onChange({ recoveryKey: recoveryKey.trim() });
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>{action}</DialogTitle>
      </DialogHeader>
      {isReplacing ? (
        <div className="flex flex-col gap-1">
          <p className="text-meta font-medium">Current</p>
          <p className="font-mono text-id text-muted-foreground" title={current}>
            {shortened(current)}
          </p>
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={recoveryKeyId}>New recovery key</Label>
        <Input
          id={recoveryKeyId}
          isMono
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="age1…"
          data-testid="recovery-key-input"
          aria-describedby={recoveryKeyHelpId}
          className="max-sm:h-(--size-control-touch) max-sm:text-input-touch"
          value={recoveryKey}
          onChange={(event) => {
            setRecoveryKey(event.target.value);
          }}
        />
        <p id={recoveryKeyHelpId} className="text-meta text-muted-foreground">
          The public half of an age key you keep offline.
        </p>
      </div>
      <ul className="list-disc pl-5 text-meta text-foreground">
        {isReplacing ? <li>The current recovery key stops opening this fleet’s keys.</li> : null}
        <li>A recovery key can be replaced, never removed.</li>
      </ul>
      {refusal === undefined ? null : <SealingRefusalError refusal={refusal} fleetId={fleetId} failed={`Couldn’t ${isReplacing ? 'replace' : 'set'} the recovery key`} />}
      <DialogFooter>
        <DialogClose render={<Button type="button" disabled={isPending} />}>Cancel</DialogClose>
        <Button type="submit" variant="primary" isLoading={isPending} disabled={!canSubmit} data-testid="recovery-key-submit">
          {isPending ? 'Wrapping the data keys…' : action}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * Replace recovery key, or Set recovery key on a fleet sealed without one
 * (sealing page mockup; decision 0068, B13d): every data key is wrapped to
 * the new one. There is no Remove: a recovery key can be replaced, never
 * removed. A refusal shows inline with the input kept.
 */
export function RecoveryKeyDialog({ isOpen, onOpenChange, ...form }: RecoveryKeyDialogProps) {
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(isOpening) => {
        if (!form.isPending) {
          onOpenChange(isOpening);
        }
      }}
    >
      <DialogContent size="md" data-testid="recovery-key-dialog" className={dialogSurface.phoneFullScreen}>
        {isOpen ? <RecoveryKeyForm {...form} /> : null}
      </DialogContent>
    </Dialog>
  );
}
