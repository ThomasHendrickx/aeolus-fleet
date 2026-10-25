'use client';

import { LoaderCircle } from 'lucide-react';

import { Switch } from '../../../../components/atoms/switch';
import { InlineError } from '../../../../components/molecules/inline-error';
import { LoadingSkeleton } from '../../../../components/molecules/loading-skeleton';
import { ModelTag } from '../../../../components/molecules/model-tag';
import type { ModelRow } from '../../services/model-rows';

/** One model's Switch flipped: enable it, or disable it. */
export interface ModelChange {
  model: string;
  isEnabled: boolean;
}

export interface ModelsSectionProps {
  /** Every model a trierarch reports or the fleet enables; undefined while not known. */
  rows: readonly ModelRow[] | undefined;
  /** Why the fleet's enabled models or the machines' reports could not be read. */
  error?: string;
  onRetry: () => void;
  /** fleet:manage: a viewer sees the Switches disabled. */
  canManage: boolean;
  /** The change being saved: its Switch shows it, every Switch waits. */
  pending?: ModelChange;
  /** Why the last change was refused, by its row: the Switch is back where it was. */
  failed?: ModelChange & { message: string };
  onChange: (change: ModelChange) => void;
}

const WORDS = {
  noRule: 'Every model is allowed. Enable a model to allow only the enabled ones.',
  rule: 'Only enabled models are placed. Crews already running keep their model.',
} as const;

function machinesWords(count: number): string {
  if (count === 0) {
    return 'no trierarch reports it';
  }
  return count === 1 ? '1 machine' : `${String(count)} machines`;
}

/**
 * The Models section on the Trierarchs page (model governance, M7): one row
 * per model a trierarch reports or the fleet enables, with the harnesses
 * that report it, how many machines do and a Switch. With no model enabled
 * every model is allowed; with one or more only those are placed. Props only:
 * the confirm for the first and the last model sits with its container.
 */
export function ModelsSection({ rows, error, onRetry, canManage, pending, failed, onChange }: ModelsSectionProps) {
  const hasRule = rows?.some((row) => row.isEnabled) ?? false;
  let content;
  if (error !== undefined) {
    content = <InlineError title="Couldn’t read the models" description={`${error}. Nothing changed.`} onRetry={onRetry} />;
  } else if (rows === undefined) {
    content = <LoadingSkeleton variant="list" rows={3} label="Loading the models" />;
  } else if (rows.length === 0) {
    content = <p className="text-meta text-muted-foreground">No trierarch reports a model yet.</p>;
  } else {
    content = (
      <ul className="flex flex-col divide-y divide-border">
        {rows.map((row) => {
          const isSaving = pending?.model === row.model;
          const isOn = isSaving ? pending.isEnabled : row.isEnabled;
          const failure = failed?.model === row.model ? failed : undefined;
          return (
            <li key={row.model} data-testid="trierarchs-model" className="flex flex-col gap-2 py-2.5 first:pt-0 last:pb-0">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1 md:flex-row md:items-center md:gap-3">
                  <ModelTag model={{ id: row.model }} isCrewed />
                  <span className="text-meta text-muted-foreground" data-testid="trierarchs-model-reported">
                    {row.harnesses.length === 0 ? machinesWords(0) : `${row.harnesses.join(', ')} · ${machinesWords(row.machineCount)}`}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {isSaving ? (
                    <span role="status" className="flex items-center gap-1.5 text-meta text-muted-foreground [&_svg]:size-(--size-icon-sm)">
                      <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />
                      {pending.isEnabled ? 'Enabling…' : 'Disabling…'}
                    </span>
                  ) : null}
                  <Switch
                    checked={isOn}
                    disabled={!canManage || pending !== undefined}
                    aria-label={`${row.model}: ${isOn ? 'enabled' : 'disabled'}`}
                    data-testid="trierarchs-model-switch"
                    onCheckedChange={(isChecked) => {
                      onChange({ model: row.model, isEnabled: isChecked });
                    }}
                  />
                </div>
              </div>
              {failure === undefined ? null : (
                <InlineError
                  title={`Couldn’t ${failure.isEnabled ? 'enable' : 'disable'} ${row.model}`}
                  description={`${failure.message}. Nothing changed.`}
                  onRetry={() => {
                    onChange({ model: failure.model, isEnabled: failure.isEnabled });
                  }}
                />
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <section aria-labelledby="trierarchs-models" data-testid="trierarchs-models" className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <h2 id="trierarchs-models" className="text-section font-semibold">
        Models
      </h2>
      {rows === undefined || error !== undefined ? null : (
        <p className="text-meta text-muted-foreground" data-testid="trierarchs-models-rule">
          {hasRule ? WORDS.rule : WORDS.noRule}
        </p>
      )}
      {content}
    </section>
  );
}
