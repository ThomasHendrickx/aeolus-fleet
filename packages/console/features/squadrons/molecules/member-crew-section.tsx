'use client';

import { ChevronDown, ChevronRight, CircleCheck, CircleDashed } from 'lucide-react';
import { useId, type ReactNode } from 'react';

import { classNames } from '../../../lib/class-names';
import type { HarnessOffer } from '../../../lib/crew-settings-form';
import { missingOf, workspaceFromItem, workspaceItemOf, type MemberValues } from '../../../lib/forming-members';
import { harnessWord } from '../../../lib/harness';
import type { MachineLabelsInput } from '../../../lib/machine-labels';
import { Input } from '../../../components/atoms/input';
import { Label } from '../../../components/atoms/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/atoms/select';
import { Textarea } from '../../../components/atoms/textarea';
import { InlineError } from '../../../components/molecules/inline-error';
import { MachineLabelsField } from '../../../components/molecules/machine-labels-field';

interface MemberCrewSectionProps {
  member: MemberValues;
  /** What the answering machines offer, harness by harness. */
  offers: readonly HarnessOffer[];
  /** Every workspace a member may pick, as select items. */
  workspaces: Readonly<Record<string, string>>;
  /** The fleet's labels and machines, for its machine labels; the field waits for them. */
  machineLabels?: MachineLabelsInput;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  isDisabled?: boolean;
  /** Why forming refused this member, such as a machine label the fleet does not have. */
  error?: string;
  onChange: (member: MemberValues) => void;
}

/** The value a select holds for "not given". */
const NONE = '';

function Field({ id, label, isRequired, hint, children }: { id: string; label: string; isRequired?: boolean; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>
        {label}
        <span className="font-normal text-muted-foreground">{isRequired ? ' required' : ' optional'}</span>
      </Label>
      {children}
      {hint === undefined ? null : <p className="text-meta text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Pick({ id, items, value, onPick, isDisabled, testId }: { id: string; items: Record<string, string>; value: string; onPick: (value: string) => void; isDisabled?: boolean; testId: string }) {
  return (
    <Select
      items={items}
      value={value}
      disabled={isDisabled}
      onValueChange={(picked) => {
        onPick(typeof picked === 'string' ? picked : NONE);
      }}
    >
      <SelectTrigger id={id} data-testid={testId}>
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

/** An option value as the form shows it: text as it is, anything else as JSON. */
function optionText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * One member's crew settings in the forming form (#343, S4): a header with
 * its slot, template and what it still needs, folding its fields away once
 * it needs nothing; then its workspace (required), harness, options, first
 * prompt, machine labels and the parameters its role left to fill
 * (required). Starts from its files; every change is the form's, nearest wins.
 */
export function MemberCrewSection({ member, offers, workspaces, machineLabels, isOpen, onOpenChange, isDisabled, error, onChange }: MemberCrewSectionProps) {
  const ids = { workspace: useId(), harness: useId(), options: useId(), firstPrompt: useId(), parameters: useId() };
  const missing = missingOf(member);
  const offer = offers.find((each) => each.harness === member.harness);
  const harnesses = { [NONE]: 'The trierarch’s default', ...Object.fromEntries(offers.map((each) => [each.harness, harnessWord(each.harness)])), ...(member.harness === NONE || offer ? {} : { [member.harness]: harnessWord(member.harness) }) };
  const offered = new Set((offer?.options ?? []).map((option) => option.name));
  const otherOptions = Object.entries(member.options).filter(([name]) => !offered.has(name));
  const Chevron = isOpen ? ChevronDown : ChevronRight;

  return (
    <section aria-label={member.slot} data-testid="member-crew-section" className={classNames('flex flex-col rounded-lg border bg-card', error === undefined ? 'border-border' : 'border-tone-attention-border')}>
      <button
        type="button"
        aria-expanded={isOpen}
        data-testid="member-crew-toggle"
        className="flex min-h-11 items-center gap-2.5 px-3.5 py-2 text-left focus-visible:outline-2 focus-visible:outline-ring [&_svg]:size-(--size-icon-sm) [&_svg]:shrink-0"
        onClick={() => {
          onOpenChange(!isOpen);
        }}
      >
        <Chevron aria-hidden className="text-muted-foreground" />
        <span className="font-mono text-body font-medium">{member.slot}</span>
        <span className="font-mono text-meta text-muted-foreground">{member.template}</span>
        <span className="flex-1" />
        {missing.length === 0 ? (
          <span className="inline-flex items-center gap-1 text-meta text-tone-ok-fg" data-testid="member-crew-ready">
            <CircleCheck aria-hidden />
            Ready
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-meta text-tone-waiting-fg" data-testid="member-crew-missing">
            <CircleDashed aria-hidden />
            Needs {missing.join(', ')}
          </span>
        )}
      </button>
      {error === undefined ? null : (
        <div className="px-3.5 pb-3">
          <InlineError variant="field" title={error} />
        </div>
      )}
      {isOpen ? (
        <div className="flex flex-col gap-4 border-t border-border px-3.5 py-3.5">
          <Field id={ids.workspace} label="Workspace" isRequired hint="A repository gets a new git worktree for this ship; a folder is used as it is.">
            <Pick
              id={ids.workspace}
              items={workspaces}
              value={member.workspace === undefined ? NONE : workspaceItemOf(member.workspace)}
              isDisabled={isDisabled}
              testId="member-crew-workspace"
              onPick={(picked) => {
                onChange({ ...member, workspace: workspaceFromItem(picked) });
              }}
            />
          </Field>
          <Field id={ids.harness} label="Harness">
            <Pick
              id={ids.harness}
              items={harnesses}
              value={member.harness}
              isDisabled={isDisabled}
              testId="member-crew-harness"
              onPick={(harness) => {
                onChange({ ...member, harness });
              }}
            />
          </Field>
          {(offer?.options ?? []).map((option, index) => (
            <Field key={option.name} id={`${ids.options}-${String(index)}`} label={option.name}>
              <Pick
                id={`${ids.options}-${String(index)}`}
                items={{
                  [NONE]: 'The trierarch’s default',
                  ...Object.fromEntries(option.values.map((value) => [value, value === option.defaultValue ? `${value} (default)` : value])),
                  ...(typeof member.options[option.name] === 'string' && !option.values.includes(optionText(member.options[option.name])) ? { [optionText(member.options[option.name])]: optionText(member.options[option.name]) } : {}),
                }}
                value={member.options[option.name] === undefined ? NONE : optionText(member.options[option.name])}
                isDisabled={isDisabled}
                testId="member-crew-option"
                onPick={(picked) => {
                  const rest = Object.fromEntries(Object.entries(member.options).filter(([name]) => name !== option.name));
                  onChange({ ...member, options: picked === NONE ? rest : { ...rest, [option.name]: picked } });
                }}
              />
            </Field>
          ))}
          {otherOptions.length === 0 ? null : (
            <div className="flex flex-col gap-1" data-testid="member-crew-file-options">
              <span className="text-body font-medium">From its files</span>
              <ul className="flex flex-wrap gap-1.5">
                {otherOptions.map(([name, value]) => (
                  <li key={name} className="rounded-sm bg-secondary px-1.5 py-0.5 font-mono text-id">
                    {name}={optionText(value)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {machineLabels === undefined ? null : (
            <MachineLabelsField
              shipName={member.slot}
              picked={machineLabels.chipsOf(member.machineLabels)}
              groups={machineLabels.groups}
              match={machineLabels.matchOf(member.machineLabels)}
              max={machineLabels.max}
              isDisabled={isDisabled}
              unknown={member.unknownLabels}
              onAdd={(valueId) => {
                onChange({ ...member, machineLabels: [...member.machineLabels, valueId] });
              }}
              onRemove={(valueId) => {
                onChange({ ...member, machineLabels: member.machineLabels.filter((each) => each !== valueId) });
              }}
              onRemoveUnknown={(name) => {
                onChange({ ...member, unknownLabels: member.unknownLabels.filter((each) => each !== name) });
              }}
            />
          )}
          <Field id={ids.firstPrompt} label="First prompt" hint="The session starts with it, on its first start only.">
            <Textarea
              id={ids.firstPrompt}
              value={member.firstPrompt}
              disabled={isDisabled}
              data-testid="member-crew-first-prompt"
              rows={2}
              onChange={(event) => {
                onChange({ ...member, firstPrompt: event.target.value });
              }}
            />
          </Field>
          {member.parameters.map((parameter, index) => (
            <Field key={parameter.name} id={`${ids.parameters}-${String(index)}`} label={parameter.name} isRequired hint={parameter.description}>
              <Input
                id={`${ids.parameters}-${String(index)}`}
                value={parameter.value}
                disabled={isDisabled}
                aria-invalid={parameter.value.trim() === '' ? true : undefined}
                data-testid="member-crew-parameter"
                onChange={(event) => {
                  onChange({ ...member, parameters: member.parameters.map((each) => (each.name === parameter.name ? { ...each, value: event.target.value } : each)) });
                }}
              />
            </Field>
          ))}
        </div>
      ) : null}
    </section>
  );
}
