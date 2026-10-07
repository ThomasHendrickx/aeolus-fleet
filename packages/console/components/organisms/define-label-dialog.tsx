'use client';

import { LABEL_HANDLE_MAX_LENGTH, LABEL_VALUES_MAX } from '@aeolus-fleet/common';
import { UserRound, X } from 'lucide-react';
import { useId, useState } from 'react';

import { classNames } from '../../lib/class-names';
import { labelTextProblem } from '../../lib/labels';
import { Button } from '../atoms/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../atoms/dialog';
import { Input } from '../atoms/input';
import { Label } from '../atoms/label';
import { InlineError } from '../molecules/inline-error';

interface DefineLabelDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  isPending: boolean;
  /** Why the server refused it, naming the rule or the key's owner; the dialog stays open with the input kept. */
  error?: string;
  onSubmit: (label: { key: string; values: string[] }) => void;
}

/** The form: a key, then the values typed one by one, each added with Enter. */
function DefineForm({ isPending, error, onSubmit }: Pick<DefineLabelDialogProps, 'isPending' | 'error' | 'onSubmit'>) {
  const keyId = useId();
  const keyHelpId = useId();
  const valueId = useId();
  const valueHelpId = useId();
  const [key, setKey] = useState('');
  const [values, setValues] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const keyProblem = labelTextProblem(key, 'Key');
  const draftProblem = labelTextProblem(draft.trim(), 'Value') ?? (values.includes(draft.trim()) ? `${draft.trim()} is a value already.` : undefined);
  const isFull = values.length >= LABEL_VALUES_MAX;
  const canDefine = key !== '' && keyProblem === undefined && values.length > 0 && !isPending;

  const addDraft = () => {
    const value = draft.trim();
    if (value === '' || draftProblem !== undefined || isFull) {
      return;
    }
    setValues([...values, value]);
    setDraft('');
  };

  return (
    <form
      noValidate
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        if (canDefine) {
          onSubmit({ key, values });
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>Define a label</DialogTitle>
        <DialogDescription>A key and the values ships can carry, like os with macos and linux.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <Label htmlFor={keyId}>Key</Label>
          <span className="text-caption text-muted-foreground tabular-nums">
            {key.length} / {LABEL_HANDLE_MAX_LENGTH}
          </span>
        </div>
        <Input
          id={keyId}
          isMono
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="project"
          data-testid="define-label-key"
          aria-invalid={keyProblem === undefined ? undefined : true}
          aria-describedby={keyHelpId}
          className="max-sm:h-(--size-control-touch) max-sm:text-input-touch"
          value={key}
          onChange={(event) => {
            setKey(event.target.value);
          }}
        />
        <p id={keyHelpId} aria-live="polite" className={classNames('text-meta', keyProblem === undefined ? 'text-muted-foreground' : 'text-destructive-text')}>
          {keyProblem ?? `Lowercase letters, digits and -, up to ${String(LABEL_HANDLE_MAX_LENGTH)} characters. Unique in the fleet.`}
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <Label htmlFor={valueId}>Values</Label>
          <span className="text-caption text-muted-foreground tabular-nums">
            {values.length} of {LABEL_VALUES_MAX}
          </span>
        </div>
        <div
          className={classNames(
            'flex min-h-(--size-control) flex-wrap items-center gap-1.5 rounded-md border bg-card px-2 py-1.5 shadow-sm focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20',
            draftProblem === undefined ? 'border-input' : 'border-destructive',
          )}
        >
          {values.map((value) => (
            <span key={value} className="inline-flex h-6 items-center gap-1 rounded-sm border border-border bg-secondary px-1.5 font-mono text-id" data-testid="define-label-value">
              {value}
              <button
                type="button"
                aria-label={`Remove value ${value}`}
                className="inline-flex size-4 items-center justify-center rounded-xs text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-3"
                onClick={() => {
                  setValues(values.filter((each) => each !== value));
                }}
              >
                <X aria-hidden />
              </button>
            </span>
          ))}
          <input
            id={valueId}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            disabled={isFull}
            placeholder={isFull ? 'No more values' : values.length === 0 ? 'Add a value, then Enter' : ''}
            aria-invalid={draftProblem === undefined ? undefined : true}
            aria-describedby={valueHelpId}
            data-testid="define-label-value-input"
            className="h-6 min-w-24 flex-1 bg-transparent font-mono text-body outline-none placeholder:font-sans placeholder:text-muted-foreground disabled:cursor-not-allowed max-sm:text-input-touch"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addDraft();
              }
            }}
            onBlur={addDraft}
          />
        </div>
        <p id={valueHelpId} aria-live="polite" className={classNames('text-meta', draftProblem === undefined && !isFull ? 'text-muted-foreground' : 'text-destructive-text')}>
          {draftProblem ?? (isFull ? `Values: a label has at most ${String(LABEL_VALUES_MAX)} values (decision 0031).` : 'Each value a ship can carry. You can add values later.')}
        </p>
      </div>
      <p className="flex items-center gap-2 text-meta text-muted-foreground [&_svg]:size-(--size-icon-sm)">
        <UserRound aria-hidden />
        Owner: argo (you). Only you assign it, on ship pages.
      </p>
      {error === undefined ? null : <InlineError title="Couldn’t define the label" description={`Refused: ${error}. Nothing changed.`} />}
      <DialogFooter>
        <DialogClose render={<Button type="button" disabled={isPending} />}>Cancel</DialogClose>
        <Button type="submit" variant="primary" isLoading={isPending} disabled={!canDefine} data-testid="define-label-submit">
          Define label
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * Define a label (canvas Labels, LbDefine, LbDefineExists, LbDefineInvalid,
 * LbDefineLimit, LbMDefine): its key and its values. A key or value outside
 * the rule is named under its field before anything is sent; a key the fleet
 * has is refused by the server, naming its owner. argo owns what it defines.
 */
export function DefineLabelDialog({ isOpen, onOpenChange, isPending, error, onSubmit }: DefineLabelDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent data-testid="define-label-dialog">{isOpen ? <DefineForm isPending={isPending} error={error} onSubmit={onSubmit} /> : null}</DialogContent>
    </Dialog>
  );
}
