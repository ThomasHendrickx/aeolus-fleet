import { useId } from 'react';

import { byteSize, promptBytes, withHarness, type CrewSettingsValues, type HarnessOffer } from '../../lib/crew-settings-form';
import { harnessWord } from '../../lib/harness';
import type { MachineLabelsInput } from '../../lib/machine-labels';
import { Textarea } from '../atoms/textarea';
import { MachineLabelsField } from './machine-labels-field';
import { McpServersField } from './mcp-servers-field';
import { SettingsField } from './settings-field';
import { SettingsSelect } from './settings-select';
import { WorkspaceFields } from './workspace-fields';

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
  const ids = { harness: useId(), options: useId(), firstPrompt: useId(), squadron: useId() };
  const offer = offers.find((each) => each.harness === values.harness);
  const errorOf = (field: string) => (refusal?.field === field ? refusal.reason : undefined);
  const bytes = promptBytes(values.firstPrompt);
  const isPromptTooLong = bytes > firstPromptMaxBytes;
  return (
    <div className="flex flex-col gap-4" data-testid="crew-settings-fields">
      <SettingsField id={ids.harness} label="Harness" error={errorOf('harness')}>
        <SettingsSelect
          id={ids.harness}
          items={Object.fromEntries(offers.map((each) => [each.harness, harnessWord(each.harness)]))}
          value={values.harness}
          isDisabled={isDisabled}
          testId="crew-settings-harness"
          onPick={(harness) => {
            onChange(withHarness(values, { harness, offers }));
          }}
        />
      </SettingsField>
      <WorkspaceFields
        shipName={shipName}
        offered={offer ?? { repositories: [], folders: [] }}
        workspace={values.workspace}
        {...(refusal?.field === 'workspace' ? { refusal: refusal.reason } : {})}
        isDisabled={isDisabled}
        onChange={(workspace) => {
          onChange({ ...values, workspace });
        }}
      />
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
        <SettingsField key={option.name} id={`${ids.options}-${String(index)}`} label={option.name} error={index === 0 ? errorOf('options') : undefined}>
          <SettingsSelect
            id={`${ids.options}-${String(index)}`}
            items={Object.fromEntries(option.values.map((value): [string, string] => [value, value === option.defaultValue ? `${value} (default)` : value]))}
            value={values.options[option.name] ?? NONE}
            isDisabled={isDisabled}
            testId={`crew-settings-option-${option.name}`}
            onPick={(picked) => {
              onChange({ ...values, options: { ...values.options, [option.name]: picked } });
            }}
          />
        </SettingsField>
      ))}
      <SettingsField
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
      </SettingsField>
      {squadrons === undefined ? null : (
        <SettingsField id={ids.squadron} label="Squadron" isOptional hint="The session starts with that squadron’s crew line and template." error={errorOf('squadron')}>
          <SettingsSelect
            id={ids.squadron}
            items={{ [NONE]: 'None', ...Object.fromEntries(squadrons.map((squadron) => [squadron, squadron])) }}
            value={values.squadron}
            isDisabled={isDisabled}
            testId="crew-settings-squadron"
            onPick={(squadron) => {
              onChange({ ...values, squadron });
            }}
          />
        </SettingsField>
      )}
    </div>
  );
}
