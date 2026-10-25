import type { CrewSettings, LabelValueId } from '@aeolus-fleet/common';

import { harnessOptions, type HarnessOption } from './machines';
import type { Machine } from './trierarch-plugin-schemas';

/**
 * The Request crew form, built from what the machines offer (#245, S3): per
 * harness, the workspaces and options any answering machine offers. The form
 * says only what can be picked; whether a trierarch takes the settings is the
 * trierarch plugin's to check (`requests.check`), and the fleet stores them
 * without meaning.
 */

/** A harness some answering machine offers, with every workspace and option value the machines offering it have. */
export interface HarnessOffer {
  harness: string;
  repositories: string[];
  folders: string[];
  options: HarnessOption[];
}

function union(into: string[], values: readonly string[]): void {
  for (const value of values) {
    if (!into.includes(value)) {
      into.push(value);
    }
  }
}

/** The crew settings option that names the model a session runs. */
const MODEL_OPTION = 'model';

/**
 * A harness offer under the fleet's enabled models (model governance, M8):
 * only the enabled values of its model option, at the reported default when
 * that is enabled, else the first enabled one; undefined when it offers no
 * enabled model, or no model option at all, as placement does not fit it.
 */
function withEnabledModels(offer: HarnessOffer, enabledModels: readonly string[]): HarnessOffer | undefined {
  const model = offer.options.find((option) => option.name === MODEL_OPTION);
  const values = model?.values.filter((value) => enabledModels.includes(value)) ?? [];
  const [first] = values;
  if (model === undefined || first === undefined) {
    return undefined;
  }
  const defaultValue = model.defaultValue !== undefined && values.includes(model.defaultValue) ? model.defaultValue : first;
  return { ...offer, options: offer.options.map((option) => (option === model ? { name: MODEL_OPTION, values, defaultValue } : option)) };
}

/**
 * What the answering machines offer, harness by harness, in the order the
 * machines report them; silent ones are left out. In a fleet that enables
 * models, only those are offered; none enabled is no rule.
 */
export function offersOf(machines: readonly Machine[], enabledModels: readonly string[]): HarnessOffer[] {
  const offers = reportedOffersOf(machines);
  return enabledModels.length === 0 ? offers : offers.flatMap((offer) => withEnabledModels(offer, enabledModels) ?? []);
}

function reportedOffersOf(machines: readonly Machine[]): HarnessOffer[] {
  const offers: HarnessOffer[] = [];
  for (const machine of machines) {
    if (machine.isSilent || machine.details === null) {
      continue;
    }
    for (const reported of machine.details.harnesses) {
      let offer = offers.find((each) => each.harness === reported.harness);
      if (offer === undefined) {
        offer = { harness: reported.harness, repositories: [], folders: [], options: [] };
        offers.push(offer);
      }
      union(offer.repositories, machine.details.workspaces.repositories);
      union(offer.folders, machine.details.workspaces.folders);
      for (const option of harnessOptions(reported.options)) {
        const held = offer.options.find((each) => each.name === option.name);
        if (held === undefined) {
          offer.options.push({ ...option, values: [...option.values] });
        } else {
          union(held.values, option.values);
          held.defaultValue ??= option.defaultValue;
        }
      }
    }
  }
  return offers;
}

/** A workspace as the form picks it: a new worktree of a repository, or a folder used as it is. */
export type WorkspaceChoice = { kind: 'worktree'; repository: string } | { kind: 'folder'; name: string };

/** The form's values: always strings, so a field is never uncontrolled; empty means not given. */
export interface CrewSettingsValues {
  harness: string;
  workspace: WorkspaceChoice | undefined;
  options: Record<string, string>;
  firstPrompt: string;
  squadron: string;
  /** The label value ids a machine must carry, every one; none for any machine. */
  machineLabels: LabelValueId[];
}

/** Each option at its default, or its first value when it has none. */
function defaultOptions(offer: HarnessOffer | undefined): Record<string, string> {
  return Object.fromEntries((offer?.options ?? []).flatMap((option) => {
    const value = option.defaultValue ?? option.values[0];
    return value === undefined ? [] : [[option.name, value]];
  }));
}

function firstWorkspace(offer: HarnessOffer | undefined): WorkspaceChoice | undefined {
  const [repository] = offer?.repositories ?? [];
  if (repository !== undefined) {
    return { kind: 'worktree', repository };
  }
  const [folder] = offer?.folders ?? [];
  return folder === undefined ? undefined : { kind: 'folder', name: folder };
}

/** A new form: the first harness offered, its first workspace and its options at their defaults. */
export function defaultValues(offers: readonly HarnessOffer[]): CrewSettingsValues {
  const [offer] = offers;
  return { harness: offer?.harness ?? '', workspace: firstWorkspace(offer), options: defaultOptions(offer), firstPrompt: '', squadron: '', machineLabels: [] };
}

/** The form after picking a harness: its workspace kept while that harness offers it, its options back at their defaults. */
export function withHarness(values: CrewSettingsValues, pick: { harness: string; offers: readonly HarnessOffer[] }): CrewSettingsValues {
  const { harness, offers } = pick;
  const offer = offers.find((each) => each.harness === harness);
  const workspace = values.workspace;
  const isOffered =
    workspace !== undefined && (workspace.kind === 'worktree' ? (offer?.repositories.includes(workspace.repository) ?? false) : (offer?.folders.includes(workspace.name) ?? false));
  return { ...values, harness, workspace: isOffered ? workspace : firstWorkspace(offer), options: defaultOptions(offer) };
}

/**
 * The form filled from settings a request holds, for Edit; anything that is
 * no crew setting starts as a new form. A model the fleet no longer enables
 * gives way to the harness's enabled default (model governance, M8).
 */
export function valuesOf(settings: CrewSettings | null | undefined, offered: { offers: readonly HarnessOffer[]; enabledModels: readonly string[] }): CrewSettingsValues {
  const { offers, enabledModels } = offered;
  if (settings === undefined || settings === null) {
    return defaultValues(offers);
  }
  const { harness, workspace, options, firstPrompt, squadron, machineLabels } = settings;
  // Without a harness a trierarch crews with its first; the form picks the first offered (#343).
  const picked = harness ?? defaultValues(offers).harness;
  const held: Record<string, string> = Object.fromEntries(Object.entries(options).flatMap(([name, value]) => (typeof value === 'string' ? [[name, value]] : [])));
  const heldModel = held[MODEL_OPTION];
  const isModelDisabled = enabledModels.length > 0 && heldModel !== undefined && !enabledModels.includes(heldModel);
  const enabledDefault = defaultOptions(offers.find((offer) => offer.harness === picked))[MODEL_OPTION];
  const kept = isModelDisabled ? Object.fromEntries(Object.entries(held).filter(([name]) => name !== MODEL_OPTION)) : held;
  return {
    harness: picked,
    workspace: workspace.kind === 'worktree' ? { kind: 'worktree', repository: workspace.repository } : { kind: 'folder', name: workspace.name },
    options: isModelDisabled && enabledDefault !== undefined ? { ...kept, [MODEL_OPTION]: enabledDefault } : kept,
    firstPrompt: firstPrompt ?? '',
    squadron: squadron ?? '',
    machineLabels: [...(machineLabels ?? [])],
  };
}

/** The settings the form makes, as a crew request holds them; undefined until a harness and a workspace are picked. */
export function settingsOf(values: CrewSettingsValues): CrewSettings | undefined {
  if (values.harness === '' || values.workspace === undefined) {
    return undefined;
  }
  return {
    harness: values.harness,
    workspace: values.workspace,
    options: values.options,
    ...(values.firstPrompt === '' ? {} : { firstPrompt: values.firstPrompt }),
    ...(values.squadron === '' ? {} : { squadron: values.squadron }),
    ...(values.machineLabels.length === 0 ? {} : { machineLabels: values.machineLabels }),
  };
}

const utf8 = new TextEncoder();

/** A first prompt's size in UTF-8 bytes, as the limit counts it. */
export function promptBytes(prompt: string): number {
  return utf8.encode(prompt).byteLength;
}

/** "112 B", "1.2 KB": a size as the console words it. */
export function byteSize(bytes: number): string {
  const KB = 1024;
  return bytes < KB ? `${String(bytes)} B` : `${(bytes / KB).toFixed(1).replace(/\.0$/, '')} KB`;
}

/** One fact of a request's settings, as its card shows it: a label, the value, and what kind it is. */
export interface SettingsRow {
  label: string;
  value: string | null;
  meta?: string;
  /** Ids, option values and flags read in mono. */
  isMono?: boolean;
}

/** A request's settings as rows for its card; undefined when they are no crew settings (a request made without the plugin). */
export function settingsRows(settings: CrewSettings | null | undefined): SettingsRow[] | undefined {
  if (settings === undefined || settings === null) {
    return undefined;
  }
  const { harness, workspace, options, firstPrompt, squadron } = settings;
  return [
    { label: 'Harness', value: harness ?? 'Trierarch default' },
    workspace.kind === 'worktree'
      ? { label: 'Workspace', value: workspace.repository, meta: 'New worktree' }
      : { label: 'Workspace', value: workspace.name, meta: 'Folder, as it is' },
    ...Object.entries(options).map(([name, value]) => ({ label: name, value: typeof value === 'string' ? value : JSON.stringify(value), isMono: true })),
    { label: 'First prompt', value: firstPrompt === undefined ? null : byteSize(promptBytes(firstPrompt)) },
    { label: 'Squadron', value: squadron ?? null, isMono: true },
  ];
}
