'use client';

import type { WhileUnavailable } from '@aeolus-fleet/common';
import { useId, useState } from 'react';

import { secondsProblem, WHILE_UNAVAILABLE_WORDS } from '../../lib/network-declaration';
import type { NetworkDeclaration } from '../../lib/networking-plugin-schemas';
import { Button } from '../atoms/button';
import { Input } from '../atoms/input';
import { Label } from '../atoms/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../atoms/select';
import { InlineError } from '../molecules/inline-error';

interface NetworkDeclarationFormProps {
  /** What the plugin declares now. */
  declaration: NetworkDeclaration;
  /** The declarations common knows, in its order. */
  options: readonly WhileUnavailable[];
  bounds: { min: number; max: number };
  isSaving: boolean;
  /** Why the last save failed, as the networking plugin says it: the form keeps its values. */
  saveError?: string;
  /** What the last save did at the fleet. */
  savedNote?: string;
  onSave: (declaration: NetworkDeclaration) => void;
}

/**
 * While the networking plugin does not respond (#260; decisions 0035, 0036):
 * argo picks what holds, block all, open all or keep the latest rules, and
 * after how many seconds without a call from its ship the fleet judges it not
 * responding. The plugin registers again with it on save. The seconds are
 * checked as argo types; the plugin decides on save.
 */
export function NetworkDeclarationForm({ declaration, options, bounds, isSaving, saveError, savedNote, onSave }: NetworkDeclarationFormProps) {
  const [whileUnavailable, setWhileUnavailable] = useState(declaration.whileUnavailable);
  const [seconds, setSeconds] = useState(String(declaration.notRespondingAfterSeconds));
  const secondsId = useId();
  const problem = secondsProblem(seconds, bounds);
  const hasChanges = whileUnavailable !== declaration.whileUnavailable || seconds.trim() !== String(declaration.notRespondingAfterSeconds);
  const items = Object.fromEntries(options.map((option) => [option, WHILE_UNAVAILABLE_WORDS[option].name]));

  return (
    <section aria-labelledby="network-declaration" data-testid="network-declaration" className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <h2 id="network-declaration" className="text-body font-semibold">
        While the networking plugin does not respond
      </h2>
      <p className="text-meta text-muted-foreground">
        The fleet judges the plugin not responding when its ship makes no call for this long, and then applies what you choose here, at every send.
      </p>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (problem === undefined) {
            onSave({ whileUnavailable, notRespondingAfterSeconds: Number(seconds.trim()) });
          }
        }}
      >
        <div className="flex flex-col gap-1.5">
          <span className="text-body font-medium">What holds</span>
          <Select
            items={items}
            value={whileUnavailable}
            disabled={isSaving}
            onValueChange={(value) => {
              const chosen = options.find((option) => option === value);
              if (chosen !== undefined) {
                setWhileUnavailable(chosen);
              }
            }}
          >
            <SelectTrigger aria-label="What holds while the plugin does not respond" data-testid="network-declaration-while" className="h-(--size-control) text-body">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option} value={option}>
                  {WHILE_UNAVAILABLE_WORDS[option].name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-meta text-muted-foreground" data-testid="network-declaration-meaning">
            {WHILE_UNAVAILABLE_WORDS[whileUnavailable].meaning}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={secondsId}>Not responding after (seconds)</Label>
          <Input
            id={secondsId}
            inputMode="numeric"
            className="w-40"
            value={seconds}
            disabled={isSaving}
            aria-invalid={problem !== undefined}
            aria-describedby={`${secondsId}-hint`}
            data-testid="network-declaration-seconds"
            onChange={(event) => {
              setSeconds(event.target.value);
            }}
          />
          <p id={`${secondsId}-hint`} className={problem === undefined ? 'text-meta text-muted-foreground' : 'text-meta text-destructive'}>
            {problem ?? `From ${String(bounds.min)} to ${String(bounds.max)} seconds.`}
          </p>
        </div>
        <div>
          <Button type="submit" variant="primary" isLoading={isSaving} disabled={!hasChanges || problem !== undefined} data-testid="network-declaration-save">
            Save
          </Button>
        </div>
      </form>
      {saveError === undefined ? null : <InlineError variant="field" title="Couldn’t save" description={saveError} />}
      {savedNote === undefined || hasChanges ? null : (
        <p role="status" className="text-meta text-muted-foreground" data-testid="network-declaration-note">
          {savedNote}
        </p>
      )}
    </section>
  );
}
