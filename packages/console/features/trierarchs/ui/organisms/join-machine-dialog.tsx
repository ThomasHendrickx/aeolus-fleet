'use client';

import { CircleAlert, CircleCheck, CircleX, Plus, X } from 'lucide-react';
import { useId, useState } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import type { JoinMachineInput } from '../../../../lib/join-machine-input';
import { RadioGroup, RadioGroupItem } from '../../../../components/atoms/radio-group';

import { useConsoleConstants } from '../../../../lib/console-constants';
import { Button, Checkbox, classNames, Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, dialogSurface, DialogTitle, Input, Label, InlineError } from '@aeolus-fleet/ui';
import { asHandle, checkShipName } from '../../../../lib/ship-name';
import type { JoinedMachine } from '../../../../lib/trierarch-plugin-schemas';
import { CodeBlock } from '../../../../components/atoms/code-block';
import { CrewLines } from '../../../../components/molecules/crew-lines';
import { SetupLineBlock } from '../molecules/setup-line-block';

interface JoinMachineDialogProps {
  /** The names known to be an active ship's, read for the name typed (`onNameChange`), to say early whether it is free. */
  takenNames: readonly string[];
  /** The name as typed, so the container reads whether an active ship has it. */
  onNameChange?: (name: string) => void;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  isPending: boolean;
  /** Why the last try failed; the dialog stays open with the input kept. */
  error?: string;
  /** The joined machine, once: its setup line and starting prompt are shown only now. */
  joined?: JoinedMachine;
  onSubmit: (input: JoinMachineInput) => void;
}

const HARNESSES = [
  { value: 'claude-code', label: 'Claude Code', unattended: 'Run every tool without asking' },
  { value: 'codex', label: 'Codex', unattended: 'Run every command without asking, outside the sandbox' },
  { value: 'copilot', label: 'Copilot', unattended: undefined },
] as const;
type Harness = (typeof HARNESSES)[number]['value'];
type RepositoriesMode = 'ask' | 'list' | 'folder' | 'none';
interface JoinForm {
  name: string;
  harnesses: Harness[];
  unattended: Harness[];
  repositoriesMode: RepositoriesMode;
  entries: { value: string }[];
  folder: string;
}

/** Shape hints only: existence and repository checks belong to the machine. */
function repositoryError(value: string, isFolder = false): string | undefined {
  if (value === '' || /^(?:\/|~(?:\/|$))/.test(value) || (!isFolder && /^(?:(?:https?|ssh|git):\/\/[^\s/]+\/.+|[^\s@]+@[^\s:]+:.+)$/.test(value))) {
    return undefined;
  }
  return `${value} is no path from / or ~${isFolder ? '.' : ', and no git URL.'}`;
}

/** The name the operator gives the machine: no prefill; the trierarch's ship goes by it (#245, h). */
function NameStep({ takenNames, onNameChange, isPending, error, onSubmit }: Pick<JoinMachineDialogProps, 'takenNames' | 'onNameChange' | 'isPending' | 'error' | 'onSubmit'>) {
  const { shipHandleMaxLength } = useConsoleConstants();
  const nameId = useId();
  const statusId = useId();
  const form = useForm<JoinForm>({ defaultValues: { name: '', harnesses: [], unattended: [], repositoriesMode: 'ask', entries: [{ value: '' }], folder: '' } });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'entries' });
  const name = useWatch({ control: form.control, name: 'name', defaultValue: '' });
  const harnesses = useWatch({ control: form.control, name: 'harnesses', defaultValue: [] });
  const unattended = useWatch({ control: form.control, name: 'unattended', defaultValue: [] });
  const repositoriesMode = useWatch({ control: form.control, name: 'repositoriesMode', defaultValue: 'ask' });
  const entries = useWatch({ control: form.control, name: 'entries', defaultValue: [{ value: '' }] });
  const folder = useWatch({ control: form.control, name: 'folder', defaultValue: '' });
  const folderError = repositoryError(folder, true);
  const hasRepositoryError = repositoriesMode === 'list' ? entries.some((entry) => repositoryError(entry.value) !== undefined) : repositoriesMode === 'folder' && (folder === '' || folderError !== undefined);
  const toggleHarness = (harness: Harness, isChecked: boolean) => {
    form.setValue('harnesses', HARNESSES.filter((item) => item.value === harness ? isChecked : harnesses.includes(item.value)).map((item) => item.value));
    if (!isChecked) form.setValue('unattended', unattended.filter((item) => item !== harness));
  };
  const toggleUnattended = (harness: Harness, isChecked: boolean) => {
    form.setValue('unattended', HARNESSES.filter((item) => item.value === harness ? isChecked : unattended.includes(item.value)).map((item) => item.value));
    if (isChecked) toggleHarness(harness, true);
  };
  const check = checkShipName(name, { activeNames: takenNames });
  const isProblem = check.kind === 'invalid' || check.kind === 'reserved' || check.kind === 'taken';
  const canJoin = check.kind === 'available' && !hasRepositoryError && !isPending;

  return (
    <form
      noValidate
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        if (canJoin) {
          onSubmit({
            name,
            ...(harnesses.length === 0 ? {} : { harnesses }),
            ...(unattended.length === 0 ? {} : { unattended }),
            ...(repositoriesMode === 'ask' ? {} : { repositories: repositoriesMode === 'list' ? { kind: 'list', entries: entries.map((entry) => entry.value).filter((value) => value !== '') } : repositoriesMode === 'folder' ? { kind: 'folder', path: folder } : { kind: 'none' } }),
          });
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>Join a machine</DialogTitle>
        <DialogDescription>
          The trierarch plugin commissions a trierarch ship of this name and gives you one line to run on the machine. What you leave out here, the machine asks.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <Label htmlFor={nameId}>Name</Label>
          <span className="text-caption text-muted-foreground tabular-nums">
            {name.length} / {shipHandleMaxLength}
          </span>
        </div>
        <div className="relative">
          <Input
            disabled={isPending}
            id={nameId}
            isMono
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="trierarch-mac"
            data-testid="join-machine-name"
            aria-invalid={isProblem ? true : undefined}
            aria-describedby={statusId}
            className="pr-9 max-sm:h-(--size-control-touch) max-sm:text-input-touch"
            value={name}
            onChange={(event) => {
              form.setValue('name', asHandle(event.target.value));
              onNameChange?.(asHandle(event.target.value));
            }}
          />
          {check.kind === 'available' ? (
            <CircleCheck aria-hidden className="absolute top-1/2 right-3 size-(--size-icon) -translate-y-1/2 text-tone-ok-fg" />
          ) : isProblem ? (
            <CircleX aria-hidden className="absolute top-1/2 right-3 size-(--size-icon) -translate-y-1/2 text-destructive-text" />
          ) : null}
        </div>
        <p id={statusId} aria-live="polite" className={classNames('text-meta', isProblem ? 'text-destructive-text' : 'text-muted-foreground')}>
          {check.message}
        </p>
      </div>
      <fieldset aria-label="Harnesses" disabled={isPending} className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-col gap-1">
          <p className="text-body font-medium">Harnesses</p>
          <p className="text-meta text-muted-foreground">The harnesses its sessions run, each installed and signed in on the machine. Leave all off and the machine asks.</p>
        </div>
        {HARNESSES.map((harness) => (
          <div key={harness.value} className="flex flex-col gap-1.5">
            <Label htmlFor={`${nameId}-${harness.value}`} className="flex items-center gap-2 font-normal">
              <Checkbox id={`${nameId}-${harness.value}`} checked={harnesses.includes(harness.value)} disabled={isPending} onCheckedChange={(isChecked) => { toggleHarness(harness.value, isChecked); }} data-testid={`join-machine-${harness.value}`} />
              {harness.label}
            </Label>
            {harness.unattended === undefined ? (
              <p className="pl-6 text-meta text-muted-foreground">Runs every tool without asking (always, headless)</p>
            ) : (
              <Label htmlFor={`${nameId}-${harness.value}-unattended`} className="flex items-start gap-2 pl-6 text-meta font-normal text-muted-foreground">
                <Checkbox id={`${nameId}-${harness.value}-unattended`} checked={unattended.includes(harness.value)} disabled={isPending} onCheckedChange={(isChecked) => { toggleUnattended(harness.value, isChecked); }} data-testid={`join-machine-${harness.value}-unattended`} />
                {harness.unattended}
              </Label>
            )}
          </div>
        ))}
      </fieldset>
      <fieldset aria-label="Repositories" disabled={isPending} className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-col gap-1">
          <p className="text-body font-medium">Repositories</p>
          <p className="text-meta text-muted-foreground">Where its ships may work. Paths are on the machine, not this computer.</p>
        </div>
        <RadioGroup<RepositoriesMode> aria-label="Repositories" value={repositoriesMode} disabled={isPending} onValueChange={(value) => { form.setValue('repositoriesMode', value); }}>
          {([{ value: 'ask', label: 'Ask on the machine' }, { value: 'list', label: 'These paths or git URLs' }, { value: 'folder', label: 'Every repository in a folder' }, { value: 'none', label: 'None for now' }] as const).map((choice) => (
            <div key={choice.value} className="flex min-w-0 flex-col gap-2">
              <Label htmlFor={`${nameId}-${choice.value}`} className="flex items-center gap-2 font-normal">
                <RadioGroupItem id={`${nameId}-${choice.value}`} value={choice.value} data-testid={`join-machine-repositories-${choice.value}`} />
                {choice.label}
              </Label>
              {choice.value === 'list' && repositoriesMode === 'list' ? (
                <div className="flex min-w-0 flex-col gap-1.5 pl-6">
                  {fields.map((field, index) => {
                    const value = entries[index]?.value ?? '';
                    const error = repositoryError(value);
                    const errorId = `${nameId}-repository-${field.id}`;
                    return (
                      <div key={field.id} className="flex flex-col gap-1.5">
                        <div className="flex min-w-0 items-center gap-2">
                          <Input {...form.register(`entries.${index}.value`)} isMono disabled={isPending} aria-label={`Path or git URL ${index + 1}`} placeholder="~/code/web or git@github.com:acme/web.git" aria-invalid={error === undefined ? undefined : true} aria-describedby={error === undefined ? undefined : errorId} data-testid={`join-machine-repository-${index + 1}`} className="min-w-0 flex-1 max-sm:h-(--size-control-touch) max-sm:text-input-touch" />
                          <Button type="button" variant="ghost" size="sm" isIconOnly disabled={isPending} icon={<X />} aria-label={`Remove field ${index + 1}`} data-testid={`join-machine-remove-${index + 1}`} onClick={() => { remove(index); }} />
                        </div>
                        {error === undefined ? null : <InlineError variant="field" id={errorId} title={error} />}
                      </div>
                    );
                  })}
                  <Button type="button" variant="ghost" size="sm" className="self-start" icon={<Plus />} disabled={isPending} data-testid="join-machine-add-field" onClick={() => { append({ value: '' }); }}>Add field</Button>
                  <p className="text-meta text-muted-foreground">One path or git URL per field, each named by its last part. A git URL is cloned into ~/repositories on the machine.</p>
                </div>
              ) : null}
              {choice.value === 'folder' && repositoriesMode === 'folder' ? (
                <div className="flex flex-col gap-1.5 pl-6">
                  <Input {...form.register('folder')} isMono disabled={isPending} aria-label="Folder of repositories" placeholder="~/code" className="max-sm:h-(--size-control-touch) max-sm:text-input-touch" data-testid="join-machine-folder" aria-invalid={folderError === undefined ? undefined : true} aria-describedby={folderError === undefined ? `${nameId}-folder-hint` : `${nameId}-folder-hint ${nameId}-folder-error`} />
                  {folderError === undefined ? null : <InlineError variant="field" id={`${nameId}-folder-error`} title={folderError} />}
                  <p id={`${nameId}-folder-hint`} className="text-meta text-muted-foreground">Each git repository directly in it is added, none deeper.</p>
                </div>
              ) : null}
            </div>
          ))}
        </RadioGroup>
      </fieldset>
      {error === undefined ? null : <InlineError title="Couldn’t join the machine" description={`${error} Nothing changed.`} />}
      <DialogFooter>
        <DialogClose render={<Button type="button" disabled={isPending} />}>Cancel</DialogClose>
        <Button type="submit" variant="primary" isLoading={isPending} disabled={!canJoin} data-testid="join-machine-submit">
          {isPending ? 'Joining' : 'Join machine'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** The joined machine's setup line, then its starting prompt and crew lines: each shown once, each with its copy button. */
function JoinedStep({ joined }: { joined: JoinedMachine }) {
  const [hasCopyFailed, setHasCopyFailed] = useState(false);
  const copied = () => {
    setHasCopyFailed(false);
  };
  const failed = () => {
    setHasCopyFailed(true);
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>{joined.name} joined</DialogTitle>
        <DialogDescription>Run the setup line on the machine. It installs the trierarch, which then crews {joined.name} and reports what the machine offers.</DialogDescription>
      </DialogHeader>
      <SetupLineBlock name={joined.name} setupLine={joined.setupLine} testIdPrefix="join-machine" onCopied={copied} onCopyFailed={failed} />
      <CodeBlock
        label={`Starting prompt for ${joined.name}`}
        code={joined.prompt}
        isWrapped
        copyLabel={`Copy the starting prompt for ${joined.name}`}
        codeTestId="join-machine-prompt"
        onCopied={copied}
        onCopyFailed={failed}
      />
      <CrewLines crewLines={joined.crewLines} subject={joined.name} testIdPrefix="join-machine-crew-line" onCopied={copied} onCopyFailed={failed} />
      <p role="status" className="flex items-center gap-1.5 text-meta text-destructive-text empty:hidden">
        {hasCopyFailed ? (
          <>
            <CircleAlert aria-hidden className="size-(--size-icon-sm) shrink-0" />
            Could not copy: select the text and copy it by hand.
          </>
        ) : null}
      </p>
      <DialogFooter>
        <DialogClose render={<Button variant="primary" />}>Done</DialogClose>
      </DialogFooter>
    </>
  );
}

/**
 * Join a machine (#245; follows RenameDialog for the name, then
 * StartingPromptDialog for what is shown once): the operator names it, the
 * trierarch plugin commissions its trierarch's ship, and the dialog shows its
 * setup line and starting prompt once. Desktop: a dialog; phone: full screen.
 */
export function JoinMachineDialog(props: JoinMachineDialogProps) {
  const { isOpen, onOpenChange, isPending, joined } = props;
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(isNowOpen) => {
        if (!isPending) {
          onOpenChange(isNowOpen);
        }
      }}
    >
      <DialogContent size="md" data-testid="join-machine-dialog" className={dialogSurface.phoneFullScreen}>
        {joined === undefined ? <NameStep {...props} /> : <JoinedStep joined={joined} />}
      </DialogContent>
    </Dialog>
  );
}
