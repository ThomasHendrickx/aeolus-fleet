'use client';

import { X } from 'lucide-react';
import Link from 'next/link';
import { Fragment, useId, useState } from 'react';

import { useConsoleConstants } from '../../lib/console-constants';
import { classNames } from '../../lib/class-names';
import { labelTextProblem, type LabelRow } from '../../lib/labels';
import { Button } from '../atoms/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../atoms/dialog';
import { Input } from '../atoms/input';
import { Label } from '../atoms/label';
import { InlineError } from '../molecules/inline-error';

/** What the dialog is doing: the value being added or removed. */
export type ValuesBusy = { action: 'add'; value: string } | { action: 'remove'; valueId: string } | undefined;

interface LabelValuesDialogProps {
  /** Your label, as the Labels page lists it; the dialog is open while one is given. */
  row: LabelRow | undefined;
  onOpenChange: (isOpen: boolean) => void;
  busy?: ValuesBusy;
  /** The last change refused, with the server's words: under the value it concerned, or under Add a value. */
  error?: { valueId?: string; value: string; message: string };
  onAdd: (value: string) => void;
  onRemove: (valueId: string) => void;
}

function onShips(count: number): string {
  return count === 0 ? 'on no ship' : `on ${String(count)} ${count === 1 ? 'ship' : 'ships'}`;
}

/** A value refused, under the value or the field it concerns. */
function Refused({ error, title }: { error: NonNullable<LabelValuesDialogProps['error']>; title: string }) {
  return <InlineError title={title} description={`Refused: ${error.message}. Nothing changed.`} />;
}

/** The values with their ships and ×, then Add a value. */
function Values({ row, busy, error, onAdd, onRemove }: Omit<LabelValuesDialogProps, 'row' | 'onOpenChange'> & { row: LabelRow }) {
  const { labelValuesMax } = useConsoleConstants();
  const inputId = useId();
  const helpId = useId();
  const [draft, setDraft] = useState('');
  const value = draft.trim();
  const problem = labelTextProblem(value, 'Value') ?? (row.values.some((each) => each.value === value) ? `${value} is a value already.` : undefined);
  const isFull = row.values.length >= labelValuesMax;
  const isBusy = busy !== undefined;
  const canAdd = value !== '' && problem === undefined && !isFull && !isBusy;

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          Values of <span className="font-mono">{row.key}</span>
        </DialogTitle>
        <DialogDescription>Changes apply at once. A value that ships carry can’t be removed until you take it off them.</DialogDescription>
      </DialogHeader>
      <ul className="flex flex-col border-b border-border" data-testid="label-values">
        {row.values.map((each) => (
          <Fragment key={each.valueId}>
            <li className="grid min-h-10 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-t border-border px-0.5" data-testid="label-values-row">
              <span className="truncate font-mono text-body">{each.value}</span>
              {each.shipCount === 0 ? (
                <span className="text-meta text-muted-foreground">{onShips(0)}</span>
              ) : (
                <Link href={`/?label=${each.valueId}`} className="text-meta tabular-nums underline decoration-input underline-offset-3">
                  {onShips(each.shipCount)}
                </Link>
              )}
              <Button
                variant="ghost"
                size="sm"
                isIconOnly
                icon={<X />}
                aria-label={`Remove value ${each.value}`}
                isLoading={busy?.action === 'remove' && busy.valueId === each.valueId}
                disabled={isBusy}
                onClick={() => {
                  onRemove(each.valueId);
                }}
              />
            </li>
            {error?.valueId === each.valueId ? (
              <li className="pb-2.5">
                <Refused error={error} title={`Couldn’t remove ${each.value}`} />
              </li>
            ) : null}
          </Fragment>
        ))}
      </ul>
      <form
        noValidate
        className="flex flex-col gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          if (canAdd) {
            onAdd(value);
            setDraft('');
          }
        }}
      >
        <div className="flex items-baseline justify-between">
          <Label htmlFor={inputId}>Add a value</Label>
          <span className="text-caption text-muted-foreground tabular-nums">
            {row.values.length} of {labelValuesMax}
          </span>
        </div>
        <div className="flex gap-2">
          <Input
            id={inputId}
            isMono
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder={isFull ? 'No more values' : 'New value'}
            disabled={isFull}
            aria-invalid={problem === undefined ? undefined : true}
            aria-describedby={helpId}
            data-testid="label-values-new"
            className="max-sm:h-(--size-control-touch) max-sm:text-input-touch"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
          />
          <Button type="submit" disabled={!canAdd} isLoading={busy?.action === 'add'} data-testid="label-values-add" className="max-sm:h-(--size-control-touch)">
            Add value
          </Button>
        </div>
        <p id={helpId} aria-live="polite" className={classNames('text-meta', problem === undefined && !isFull ? 'sr-only' : 'text-destructive-text')}>
          {problem ?? (isFull ? `A label has at most ${String(labelValuesMax)} values (decision 0031).` : '')}
        </p>
        {error !== undefined && error.valueId === undefined ? <Refused error={error} title={`Couldn’t add ${error.value}`} /> : null}
      </form>
    </>
  );
}

/**
 * Change your label's values (canvas Labels, LbValues, LbValuesRefused,
 * LbMValues; Q5): each add or remove applies at once, so a refusal names the
 * exact value and the ships that carry it. No Save button; Close leaves.
 */
export function LabelValuesDialog({ row, onOpenChange, busy, error, onAdd, onRemove }: LabelValuesDialogProps) {
  return (
    <Dialog open={row !== undefined} onOpenChange={onOpenChange}>
      <DialogContent data-testid="label-values-dialog">
        {row === undefined ? null : <Values row={row} busy={busy} error={error} onAdd={onAdd} onRemove={onRemove} />}
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>Close</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
