'use client';

import { useId, useState } from 'react';

import { Button, classNames, Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@aeolus-fleet/common/header';
import { useConsoleConstants } from '../../../../lib/console-constants';
import { Input } from '../../../../components/atoms/input';
import { Label } from '../../../../components/atoms/label';
import { InlineError } from '../../../../components/molecules/inline-error';

interface ScopeDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** The fleet scope whose description changes; none to define a new one. */
  describing?: { scope: string; description: string };
  isPending: boolean;
  /** Why the server refused it, naming the rule; the dialog stays open with the input kept. */
  error?: string;
  onSubmit: (scope: { scope: string; description: string }) => void;
}

/** The form: the scope's name, fixed when only its description changes, and its one-line description. */
function ScopeForm({ describing, isPending, error, onSubmit }: Omit<ScopeDialogProps, 'isOpen' | 'onOpenChange'>) {
  const { scopeDescriptionMaxLength } = useConsoleConstants();
  const scopeId = useId();
  const scopeHelpId = useId();
  const descriptionId = useId();
  const descriptionHelpId = useId();
  const [scope, setScope] = useState(describing?.scope ?? '');
  const [description, setDescription] = useState(describing?.description ?? '');
  const isTooLong = description.length > scopeDescriptionMaxLength;
  const canSubmit = scope.trim() !== '' && description.trim() !== '' && !isTooLong && description !== describing?.description && !isPending;
  const isDefining = describing === undefined;

  return (
    <form
      noValidate
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) {
          onSubmit({ scope: scope.trim(), description: description.trim() });
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>{isDefining ? 'Define scope' : 'Change description'}</DialogTitle>
        <DialogDescription>
          {isDefining ? (
            "One of the fleet's own scopes, in your company's words. It grants nothing yet: argo holds it, and grants it to ships."
          ) : (
            <>
              What <span className="font-mono">{describing.scope}</span> allows, in one line. A scope keeps its name: a new name is a new scope.
            </>
          )}
        </DialogDescription>
      </DialogHeader>
      {isDefining ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={scopeId}>Scope</Label>
          <Input
            id={scopeId}
            isMono
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="crm:read-leads"
            data-testid="scope-dialog-scope"
            aria-describedby={scopeHelpId}
            className="max-sm:h-(--size-control-touch) max-sm:text-input-touch"
            value={scope}
            onChange={(event) => {
              setScope(event.target.value);
            }}
          />
          <p id={scopeHelpId} className="text-meta text-muted-foreground">
            &lt;namespace&gt;:&lt;action&gt;, lowercase. A namespace holds the fleet&apos;s scopes or one plugin&apos;s, never both.
          </p>
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <Label htmlFor={descriptionId}>Description</Label>
          <span className={classNames('text-caption tabular-nums', isTooLong ? 'text-destructive-text' : 'text-muted-foreground')}>
            {description.length} / {scopeDescriptionMaxLength}
          </span>
        </div>
        <Input
          id={descriptionId}
          autoComplete="off"
          placeholder="Read leads in the CRM"
          data-testid="scope-dialog-description"
          aria-invalid={isTooLong ? true : undefined}
          aria-describedby={descriptionHelpId}
          className="max-sm:h-(--size-control-touch) max-sm:text-input-touch"
          value={description}
          onChange={(event) => {
            setDescription(event.target.value);
          }}
        />
        <p id={descriptionHelpId} aria-live="polite" className={classNames('text-meta', isTooLong ? 'text-destructive-text' : 'text-muted-foreground')}>
          {isTooLong ? `A description is at most ${String(scopeDescriptionMaxLength)} characters.` : 'What a ship holding it may do. Every scope picker shows it.'}
        </p>
      </div>
      {error === undefined ? null : (
        <InlineError title={isDefining ? 'Couldn’t define the scope' : 'Couldn’t change the description'} description={`Refused: ${error}. Nothing changed.`} />
      )}
      <DialogFooter>
        <DialogClose render={<Button type="button" disabled={isPending} />}>Cancel</DialogClose>
        <Button type="submit" variant="primary" isLoading={isPending} disabled={!canSubmit} data-testid="scope-dialog-submit">
          {isDefining ? (isPending ? 'Defining…' : 'Define scope') : isPending ? 'Saving…' : 'Save description'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * Define scope, and Change description (design gateway-scopes, 4.1): one of
 * the fleet's own scopes and its one-line description. A malformed, core,
 * reserved or plugin's namespace, or a scope the fleet has, is refused by the
 * server by name, shown inline with the input kept; the dialog stays open
 * while pending so the answer is seen.
 */
export function ScopeDialog({ isOpen, onOpenChange, describing, isPending, error, onSubmit }: ScopeDialogProps) {
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(isOpening) => {
        // Escape or an outside click while pending would hide the answer: a refusal and the input with it.
        if (!isPending) {
          onOpenChange(isOpening);
        }
      }}
    >
      <DialogContent data-testid="scope-dialog">{isOpen ? <ScopeForm describing={describing} isPending={isPending} error={error} onSubmit={onSubmit} /> : null}</DialogContent>
    </Dialog>
  );
}
