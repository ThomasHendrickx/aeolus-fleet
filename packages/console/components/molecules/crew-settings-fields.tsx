import { Input, Label, InlineError } from '@aeolus-fleet/ui';
import { useId, type ReactNode } from 'react';

import {
  addableSubRepositories,
  byteSize,
  mainRepository,
  promptBytes,
  refusedSubRepository,
  withHarness,
  workspaceProblems,
  type CrewSettingsValues,
  type HarnessOffer,
  type RepositoryChoice,
  type WorkspaceChoice,
} from '../../lib/crew-settings-form';
import { harnessWord } from '../../lib/harness';
import type { MachineLabelsInput } from '../../lib/machine-labels';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../atoms/select';
import { Textarea } from '../atoms/textarea';
import { MachineLabelsField } from './machine-labels-field';
import { McpServersField } from './mcp-servers-field';
import { SubRepositoriesField } from './sub-repositories-field';

interface CrewSettingsFieldsProps {
  /** The ship the request crews, as the placement hints name it. */
  shipName: string;
  offers: readonly HarnessOffer[];
  values: CrewSettingsValues;
  onChange: (values: CrewSettingsValues) => void;
  /** The largest first prompt, in UTF-8 bytes (common's limit, handed down). */
  firstPromptMaxBytes: number;
  /** The fleet's squadrons a ship may join; none without squadrons, and the field is then left out. */
  squadrons?: readonly string[];
  /** The field the trierarch plugin refused, with why: its error shows under it. */
  refusal?: { field: string; reason: string };
  isDisabled?: boolean;
  /** The fleet's labels and machines, for the request's machine labels; the field is left out without them. */
  machineLabels?: MachineLabelsInput;
}

const NONE = '';

/** A workspace as a select value: its kind and its name. */
function workspaceValue(workspace: WorkspaceChoice | undefined): string {
  if (workspace === undefined) {
    return NONE;
  }
  return workspace.kind === 'repositories' ? `repository:${workspace.main.repository}` : `folder:${workspace.name}`;
}

/**
 * The workspace a select value picks, from the one held: another main
 * repository keeps the sub-repositories, so a repository named twice is
 * shown, never dropped silently; a folder has none.
 */
function workspaceOf(value: string, held: WorkspaceChoice | undefined): WorkspaceChoice | undefined {
  const [kind, ...rest] = value.split(':');
  const name = rest.join(':');
  if (kind === 'repository') {
    return held?.kind === 'repositories' ? { ...held, main: { repository: name, ref: held.main.ref } } : mainRepository(name);
  }
  return kind === 'folder' ? { kind: 'folder', name } : undefined;
}

function Field({ id, label, isOptional, hint, error, className, children }: { id: string; label: string; isOptional?: boolean; hint?: ReactNode; error?: string; className?: string; children: ReactNode }) {
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
 * harness, the workspace, for a repository its branch and sub-repositories
 * (docs/design/ship-repositories), with the fleet's labels its machine labels (#102),
 * its MCP servers (docs/design/crew-mcp-servers),
 * each option the harness offers, a first prompt and, with squadrons, a
 * squadron with its hint (decision 12). Built from what the
 * answering machines offer; a field the trierarch plugin refused shows why.
 */
export function CrewSettingsFields({ shipName, offers, values, onChange, firstPromptMaxBytes, squadrons, refusal, isDisabled = false, machineLabels }: CrewSettingsFieldsProps) {
  const ids = { harness: useId(), workspace: useId(), branch: useId(), options: useId(), firstPrompt: useId(), squadron: useId() };
  const offer = offers.find((each) => each.harness === values.harness);
  const errorOf = (field: string) => (refusal?.field === field ? refusal.reason : undefined);
  const { workspace } = values;
  const problems = workspaceProblems(workspace, offer);
  const refusedRow = refusal?.field === 'workspace' ? refusedSubRepository(refusal.reason, workspace) : undefined;
  const rowErrors = problems.subRepositories.map((problem, index) => problem ?? (index === refusedRow ? refusal?.reason : undefined));
  const workspaceError = problems.main ?? (refusedRow === undefined ? errorOf('workspace') : undefined);
  const withSubRepositories = (subRepositories: RepositoryChoice[]) => {
    if (workspace?.kind === 'repositories') {
      onChange({ ...values, workspace: { ...workspace, subRepositories } });
    }
  };
  const bytes = promptBytes(values.firstPrompt);
  const isPromptTooLong = bytes > firstPromptMaxBytes;
  // A held main repository no machine offers stays picked, so the form can say so.
  const heldMain = workspace?.kind === 'repositories' && !(offer?.repositories ?? []).includes(workspace.main.repository) ? [workspace.main.repository] : [];
  const workspaces: Record<string, string> = Object.fromEntries([
    ...[...heldMain, ...(offer?.repositories ?? [])].map((repository): [string, string] => [`repository:${repository}`, `${repository} · main repository`]),
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
      <div className="grid grid-cols-1 gap-x-3 gap-y-4 sm:grid-cols-[minmax(0,1fr)_11rem]">
        <Field
          id={ids.workspace}
          label="Workspace"
          hint={workspace?.kind === 'folder' ? 'A folder is used as it is, shared by the ships in it, with no sub-repositories.' : undefined}
          error={workspaceError}
          className={workspace?.kind === 'repositories' ? undefined : 'sm:col-span-2'}
        >
          <Pick
            id={ids.workspace}
            items={workspaces}
            value={workspaceValue(workspace)}
            isDisabled={isDisabled}
            testId="crew-settings-workspace"
            onPick={(picked) => {
              onChange({ ...values, workspace: workspaceOf(picked, workspace) });
            }}
          />
        </Field>
        {workspace?.kind === 'repositories' ? (
          <Field id={ids.branch} label="Branch" isOptional>
            <Input
              id={ids.branch}
              isMono
              placeholder="Default branch"
              disabled={isDisabled}
              data-testid="crew-settings-branch"
              value={workspace.main.ref}
              onChange={(event) => {
                onChange({ ...values, workspace: { ...workspace, main: { ...workspace.main, ref: event.target.value } } });
              }}
            />
          </Field>
        ) : null}
      </div>
      {workspace?.kind === 'repositories' ? (
        <SubRepositoriesField
          shipName={shipName}
          subRepositories={workspace.subRepositories}
          addable={addableSubRepositories(workspace, offer)}
          errors={rowErrors}
          isDisabled={isDisabled}
          onAdd={(repository) => {
            withSubRepositories([...workspace.subRepositories, { repository, ref: '' }]);
          }}
          onBranchChange={(changed, ref) => {
            withSubRepositories(workspace.subRepositories.map((each, index) => (index === changed ? { ...each, ref } : each)));
          }}
          onRemove={(removed) => {
            withSubRepositories(workspace.subRepositories.filter((_, index) => index !== removed));
          }}
        />
      ) : null}
      {machineLabels === undefined ? null : (
        <MachineLabelsField
          shipName={shipName}
          picked={machineLabels.chipsOf(values.machineLabels)}
          groups={machineLabels.groups}
          match={machineLabels.matchOf(values.machineLabels)}
          max={machineLabels.max}
          isDisabled={isDisabled}
          onAdd={(valueId) => {
            onChange({ ...values, machineLabels: [...values.machineLabels, valueId] });
          }}
          onRemove={(valueId) => {
            onChange({ ...values, machineLabels: values.machineLabels.filter((each) => each !== valueId) });
          }}
        />
      )}
      <McpServersField
        shipName={shipName}
        picked={values.mcpServers}
        offered={offer?.mcpServers ?? []}
        isDisabled={isDisabled}
        onAdd={(server) => {
          onChange({ ...values, mcpServers: [...values.mcpServers, server] });
        }}
        onRemove={(server) => {
          onChange({ ...values, mcpServers: values.mcpServers.filter((each) => each !== server) });
        }}
      />
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
              {byteSize(bytes)} of {byteSize(firstPromptMaxBytes)}
            </span>
          </span>
        }
        error={isPromptTooLong ? `A first prompt is at most ${byteSize(firstPromptMaxBytes)}.` : errorOf('firstPrompt')}
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
