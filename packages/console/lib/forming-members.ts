import type { WorkspaceChoice } from './crew-settings-form';
import { pickedChips, type LabelContext } from './labels';

/**
 * The forming form's members (#343, S4; docs/squadrons.md, "Crew settings"):
 * each member a blueprint forms, by its slot, starting from its crew
 * settings as squadrons merged them from its template and role. The form is
 * the third layer: what it holds goes to forming whole. A workspace and every
 * parameter are required in the form only; the rest is optional.
 */

/** An option's value, as a crew request holds it: anything JSON. */
export type OptionValue = unknown;

/** A member as squadrons answers it for the form (`catalogue.blueprintCrew`). */
export interface MemberDraft {
  slot: string;
  role: string;
  template: { repository: string; name: string; version: number };
  crew: {
    harness?: string;
    workspace?: WorkspaceChoice | { kind: 'worktree'; repository: string; ref?: string };
    firstPrompt?: string;
    options: Record<string, OptionValue>;
    machineLabels?: { key: string; value: string }[];
  };
  parameters: { name: string; description: string; value: string | null }[];
}

/** A member as the form holds it: every field a string or a choice, empty when not given. */
export interface MemberValues {
  slot: string;
  role: string;
  /** Its template, as `name@n`. */
  template: string;
  /** Empty: the trierarch's default harness. */
  harness: string;
  workspace: WorkspaceChoice | undefined;
  firstPrompt: string;
  options: Record<string, OptionValue>;
  /** The machine labels the fleet has, as value ids. */
  machineLabels: string[];
  /** Machine labels from the files the fleet does not have, as `key=value`: forming refuses them. */
  unknownLabels: string[];
  parameters: { name: string; description: string; value: string }[];
}

function workspaceOf(workspace: MemberDraft['crew']['workspace']): WorkspaceChoice | undefined {
  if (workspace === undefined) {
    return undefined;
  }
  return workspace.kind === 'worktree' ? { kind: 'worktree', repository: workspace.repository } : { kind: 'folder', name: workspace.name };
}

/** The value id of `key=value` in the fleet; undefined when the fleet has no such label value. */
function valueIdOf(label: { key: string; value: string }, context: LabelContext | undefined): string | undefined {
  return context?.labels.find((each) => each.key === label.key)?.values.find((each) => each.value === label.value)?.id;
}

/** The form's members, from what squadrons merged for each. */
export function membersOf(drafts: readonly MemberDraft[], context: LabelContext | undefined): MemberValues[] {
  return drafts.map((draft) => {
    const labels = draft.crew.machineLabels ?? [];
    return {
      slot: draft.slot,
      role: draft.role,
      template: `${draft.template.name}@${String(draft.template.version)}`,
      harness: draft.crew.harness ?? '',
      workspace: workspaceOf(draft.crew.workspace),
      firstPrompt: draft.crew.firstPrompt ?? '',
      options: { ...draft.crew.options },
      machineLabels: labels.flatMap((label) => valueIdOf(label, context) ?? []),
      unknownLabels: labels.filter((label) => valueIdOf(label, context) === undefined).map((label) => `${label.key}=${label.value}`),
      parameters: draft.parameters.map((parameter) => ({ name: parameter.name, description: parameter.description, value: parameter.value ?? '' })),
    };
  });
}

/** What a member still needs before forming: `workspace`, and the name of each parameter left empty. */
export function missingOf(member: MemberValues): string[] {
  return [...(member.workspace === undefined ? ['workspace'] : []), ...member.parameters.filter((parameter) => parameter.value.trim() === '').map((parameter) => parameter.name)];
}

/** "n of m members ready": the members that need nothing more, of all of them. */
export function readyCount(members: readonly MemberValues[]): { ready: number; total: number } {
  return { ready: members.filter((member) => missingOf(member).length === 0).length, total: members.length };
}

/** Workspace for every member: the members without one get it; the others keep theirs. */
export function withWorkspaceForAll(members: readonly MemberValues[], workspace: WorkspaceChoice): MemberValues[] {
  return members.map((member) => (member.workspace === undefined ? { ...member, workspace } : member));
}

/** A member's machine labels as `key=value` names: the fleet's by their ids, then the unknown ones. */
function labelNamesOf(member: MemberValues, context: LabelContext | undefined): { key: string; value: string }[] {
  const known = context === undefined ? [] : pickedChips(member.machineLabels, context).map((chip) => ({ key: chip.key, value: chip.value }));
  const unknown = member.unknownLabels.map((name) => {
    const [key = '', value = ''] = name.split('=');
    return { key, value };
  });
  return [...known, ...unknown];
}

/** The members as forming takes them, by slot (`squadrons.form`'s `members`): settings whole, machine labels as names. */
export function formMembersOf(
  members: readonly MemberValues[],
  context: LabelContext | undefined,
): Record<string, { crew: { harness?: string; workspace?: WorkspaceChoice; firstPrompt?: string; options: Record<string, OptionValue>; machineLabels: { key: string; value: string }[] }; parameters: Record<string, string> }> {
  return Object.fromEntries(
    members.map((member) => [
      member.slot,
      {
        crew: {
          ...(member.harness === '' ? {} : { harness: member.harness }),
          ...(member.workspace === undefined ? {} : { workspace: member.workspace }),
          ...(member.firstPrompt.trim() === '' ? {} : { firstPrompt: member.firstPrompt }),
          options: member.options,
          machineLabels: labelNamesOf(member, context),
        },
        parameters: Object.fromEntries(member.parameters.map((parameter) => [parameter.name, parameter.value])),
      },
    ]),
  );
}

/** The member whose machine label forming refused, from the `key=value` its message names; undefined for any other refusal. */
export function labelErrorSlot(message: string, form: { members: readonly MemberValues[]; context: LabelContext | undefined }): string | undefined {
  const { members, context } = form;
  const [, named] = /machine label (\S+?),/.exec(message) ?? [];
  if (named === undefined) {
    return undefined;
  }
  return members.find((member) => labelNamesOf(member, context).some((label) => `${label.key}=${label.value}` === named))?.slot;
}
