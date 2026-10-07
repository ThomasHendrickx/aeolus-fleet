import { useId, type ReactNode } from 'react';

import { byteSize, FIRST_PROMPT_MAX_BYTES, promptBytes, withHarness, type CrewSettingsValues, type HarnessOffer, type WorkspaceChoice } from '../../lib/crew-settings-form';
import { harnessWord } from '../../lib/harness';
import { Label } from '../atoms/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../atoms/select';
import { Textarea } from '../atoms/textarea';
import { InlineError } from './inline-error';

interface CrewSettingsFieldsProps {
  offers: readonly HarnessOffer[];
  values: CrewSettingsValues;
  onChange: (values: CrewSettingsValues) => void;
  /** The fleet's squadrons a ship may join; none without squadrons, and the field is then left out. */
  squadrons?: readonly string[];
  /** The field the trierarch plugin refused, with why: its error shows under it. */
  refusal?: { field: string; reason: string };
  isDisabled?: boolean;
}

const NONE = '';

/** A workspace as a select value: its kind and its name. */
function workspaceValue(workspace: WorkspaceChoice | undefined): string {
  if (workspace === undefined) {
    return NONE;
  }
  return workspace.kind === 'worktree' ? `worktree:${workspace.repository}` : `folder:${workspace.name}`;
}

function workspaceOf(value: string): WorkspaceChoice | undefined {
  const [kind, ...rest] = value.split(':');
  const name = rest.join(':');
  if (kind === 'worktree') {
    return { kind: 'worktree', repository: name };
  }
  return kind === 'folder' ? { kind: 'folder', name } : undefined;
}

function Field({ id, label, isOptional, hint, error, children }: { id: string; label: string; isOptional?: boolean; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
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

/** One select of the form: its items as value to label, the current value, and what picking does. */
function Pick({ id, items, value, onPick, isDisabled, testId }: { id: string; items: Record<string, string>; value: string; onPick: (value: string) => void; isDisabled?: boolean; testId: string }) {
  return (
    <Select
      items={items}
      value={value}
      disabled={isDisabled}
      onValueChange={(picked) => {
        if (typeof picked === 'string') {
          onPick(picked);
        }
      }}
    >
      <SelectTrigger id={id} className="h-(--size-control) w-full" data-testid={testId}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(items).map(([itemValue, label]) => (
          <SelectItem key={itemValue} value={itemValue}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * A crew request's settings as fields (canvas CrRequestForm; #245, S3): the
 * harness, the workspace, each option the harness offers, a first prompt and,
 * with squadrons, a squadron with its hint (decision 12). Built from what the
 * answering machines offer; a field the trierarch plugin refused shows why.
 */
export function CrewSettingsFields({ offers, values, onChange, squadrons, refusal, isDisabled = false }: CrewSettingsFieldsProps) {
  const ids = { harness: useId(), workspace: useId(), options: useId(), firstPrompt: useId(), squadron: useId() };
  const offer = offers.find((each) => each.harness === values.harness);
  const errorOf = (field: string) => (refusal?.field === field ? refusal.reason : undefined);
  const bytes = promptBytes(values.firstPrompt);
  const isPromptTooLong = bytes > FIRST_PROMPT_MAX_BYTES;
  const workspaces: Record<string, string> = Object.fromEntries([
    ...(offer?.repositories ?? []).map((repository): [string, string] => [`worktree:${repository}`, `${repository} · new worktree`]),
    ...(offer?.folders ?? []).map((folder): [string, string] => [`folder:${folder}`, `${folder} · folder, as it is`]),
  ]);

  return (
    <div className="flex flex-col gap-4" data-testid="crew-settings-fields">
      <Field id={ids.harness} label="Harness" error={errorOf('harness')}>
        <Pick
          id={ids.harness}
          items={Object.fromEntries(offers.map((each) => [each.harness, harnessWord(each.harness)]))}
          value={values.harness}
          isDisabled={isDisabled}
          testId="crew-settings-harness"
          onPick={(harness) => {
            onChange(withHarness(values, { harness, offers }));
          }}
        />
      </Field>
      <Field id={ids.workspace} label="Workspace" hint="A repository gets a new git worktree for this ship; a folder is used as it is, shared by the ships in it." error={errorOf('workspace')}>
        <Pick
          id={ids.workspace}
          items={workspaces}
          value={workspaceValue(values.workspace)}
          isDisabled={isDisabled}
          testId="crew-settings-workspace"
          onPick={(picked) => {
            onChange({ ...values, workspace: workspaceOf(picked) });
          }}
        />
      </Field>
      {(offer?.options ?? []).map((option, index) => (
        <Field key={option.name} id={`${ids.options}-${String(index)}`} label={option.name} error={index === 0 ? errorOf('options') : undefined}>
          <Pick
            id={`${ids.options}-${String(index)}`}
            items={Object.fromEntries(option.values.map((value): [string, string] => [value, value === option.defaultValue ? `${value} (default)` : value]))}
            value={values.options[option.name] ?? NONE}
            isDisabled={isDisabled}
            testId={`crew-settings-option-${option.name}`}
            onPick={(picked) => {
              onChange({ ...values, options: { ...values.options, [option.name]: picked } });
            }}
          />
        </Field>
      ))}
      <Field
        id={ids.firstPrompt}
        label="First prompt"
        isOptional
        hint={
          <span className="flex justify-between gap-3">
            <span>The session starts with it, on its first start only.</span>
            <span className="tabular-nums">
              {byteSize(bytes)} of {byteSize(FIRST_PROMPT_MAX_BYTES)}
            </span>
          </span>
        }
        error={isPromptTooLong ? `A first prompt is at most ${byteSize(FIRST_PROMPT_MAX_BYTES)}.` : errorOf('firstPrompt')}
      >
        <Textarea
          id={ids.firstPrompt}
          rows={3}
          disabled={isDisabled}
          aria-invalid={isPromptTooLong ? true : undefined}
          data-testid="crew-settings-first-prompt"
          value={values.firstPrompt}
          onChange={(event) => {
            onChange({ ...values, firstPrompt: event.target.value });
          }}
        />
      </Field>
      {squadrons === undefined ? null : (
        <Field id={ids.squadron} label="Squadron" isOptional hint="The session starts with that squadron’s crew line and template." error={errorOf('squadron')}>
          <Pick
            id={ids.squadron}
            items={{ [NONE]: 'None', ...Object.fromEntries(squadrons.map((squadron) => [squadron, squadron])) }}
            value={values.squadron}
            isDisabled={isDisabled}
            testId="crew-settings-squadron"
            onPick={(squadron) => {
              onChange({ ...values, squadron });
            }}
          />
        </Field>
      )}
    </div>
  );
}
