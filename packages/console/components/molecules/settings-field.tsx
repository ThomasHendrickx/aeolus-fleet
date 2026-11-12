import { InlineError, Label } from '@aeolus-fleet/ui';
import type { ReactNode } from 'react';

interface SettingsFieldProps {
  id: string;
  label: string;
  isOptional?: boolean;
  hint?: ReactNode;
  error?: string;
  className?: string;
  children: ReactNode;
}

/** One crew settings field: its label, optional or not, the control, a hint and the error under it. */
export function SettingsField({ id, label, isOptional, hint, error, className, children }: SettingsFieldProps) {
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className ?? ''}`}>
      <Label htmlFor={id}>
        {label}
        {isOptional ? <span className="font-normal text-muted-foreground"> optional</span> : null}
      </Label>
      {children}
      {hint === undefined ? null : <p className="text-meta text-muted-foreground">{hint}</p>}
      {error === undefined ? null : <InlineError variant="field" title={error} />}
    </div>
  );
}
