'use client';

import { useId } from 'react';

import { isTypedMatch } from '../../lib/ship-dialogs';
import { Input } from '../atoms/input';
import { Label } from '../atoms/label';

interface TypedConfirmProps {
  /** What the operator types to confirm: the ship's name. */
  expected: string;
  value: string;
  onValueChange: (value: string) => void;
  'data-testid'?: string;
}

/** The hint under the field: the rule while empty, then how far the text matches. Never error styling. */
function hintOf(expected: string, value: string): string {
  if (value === '') {
    return 'Case and hyphens must match.';
  }
  return isTypedMatch(expected, value) ? 'Matches. The button is now active.' : 'Doesn’t match yet.';
}

/**
 * Second confirmation for an irreversible action that loses work
 * (docs/design/png/TypedConfirm.png): retiring a ship that still holds open
 * deliveries, or renaming one that other ships may address by name. The caller keeps its action disabled until `isTypedMatch`; no
 * error styling while the operator is still typing.
 */
export function TypedConfirm({ expected, value, onValueChange, 'data-testid': testId = 'retire-typed-confirm' }: TypedConfirmProps) {
  const inputId = useId();
  const hintId = useId();

  return (
    <div data-testid={testId} className="flex flex-col gap-1.5">
      <Label htmlFor={inputId} className="text-meta">
        Type <code className="rounded-xs bg-muted px-1 py-0.5 font-mono text-id">{expected}</code> to confirm
      </Label>
      <Input
        id={inputId}
        isMono
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        aria-describedby={hintId}
        className="max-sm:h-(--size-control-touch) max-sm:text-input-touch"
        value={value}
        onChange={(event) => {
          onValueChange(event.target.value);
        }}
      />
      <p id={hintId} aria-live="polite" className="text-meta text-muted-foreground">
        {hintOf(expected, value)}
      </p>
    </div>
  );
}
