import type { CrewSettings } from '@aeolus-fleet/common';

import { workspaceChoiceOf, workspaceProblems, workspaceSettingsOf, type OfferedWorkspaces, type WorkspaceChoice } from './crew-settings-form';
import { pickedChips, type LabelContext } from './labels';

/**
 * The forming form's members (#343, S4; aeolus-fleet-squadrons' docs/squadrons.md, "Crew settings"):
 * each member a blueprint forms, by its slot, starting from its crew
 * settings as squadrons merged them from its template and role. The form is
 * the third layer: what it holds goes to forming whole. A workspace and every
 * parameter are required in the form only; the rest is optional.
 */

/** A member's workspace as squadrons' forming takes it (squadrons#46): a main repository and its sub-repositories, or a folder used as it is. */
type MemberWorkspace = CrewSettings['workspace'];

/** An option's value, as a crew request holds it: anything JSON. */
export type OptionValue = unknown;

/** A member as squadrons answers it for the form (`catalogue.blueprintCrew`). */
export interface MemberDraft {
  slot: string;
  role: string;
  template: { repository: string; name: string; version: number };
  crew: {
    harness?: string;
    workspace?: MemberWorkspace;
    firstPrompt?: string;
    options: Record<string, OptionValue>;
    machineLabels?: { key: string; value: string }[];
    mcpServers?: string[];
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
  /** The MCP servers the session starts with, by name. */
  mcpServers: string[];
  parameters: { name: string; description: string; value: string }[];
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
      workspace: draft.crew.workspace === undefined ? undefined : workspaceChoiceOf(draft.crew.workspace),
      firstPrompt: draft.crew.firstPrompt ?? '',
      options: { ...draft.crew.options },
      machineLabels: labels.flatMap((label) => valueIdOf(label, context) ?? []),
      unknownLabels: labels.filter((label) => valueIdOf(label, context) === undefined).map((label) => `${label.key}=${label.value}`),
      mcpServers: [...(draft.crew.mcpServers ?? [])],
      parameters: draft.parameters.map((parameter) => ({ name: parameter.name, description: parameter.description, value: parameter.value ?? '' })),
    };
  });
}

/** What a member still needs before forming: `workspace`, and the name of each parameter left empty. */
export function missingOf(member: MemberValues): string[] {
  return [...(member.workspace === undefined ? ['workspace'] : []), ...member.parameters.filter((parameter) => parameter.value.trim() === '').map((parameter) => parameter.name)];
}

/**
 * Why a member's workspace cannot be formed, as the crew settings footer says
 * it (docs/design/ship-repositories): a repository no machine offers, or one
 * named twice; undefined when there is nothing.
 */
export function workspaceNoteOf(member: MemberValues, repositories: readonly string[]): string | undefined {
  return workspaceProblems(member.workspace, { repositories: [...repositories] }).note;
}

/** "n of m members ready": the members that need nothing more and whose workspace has no problem, of all of them. */
export function readyCount(members: readonly MemberValues[], repositories: readonly string[]): { ready: number; total: number } {
  return { ready: members.filter((member) => missingOf(member).length === 0 && workspaceNoteOf(member, repositories) === undefined).length, total: members.length };
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
): Record<
  string,
  { crew: { harness?: string; workspace?: MemberWorkspace; firstPrompt?: string; options: Record<string, OptionValue>; machineLabels: { key: string; value: string }[]; mcpServers?: string[] }; parameters: Record<string, string> }
> {
  return Object.fromEntries(
    members.map((member) => [
      member.slot,
      {
        crew: {
          ...(member.harness === '' ? {} : { harness: member.harness }),
          ...(member.workspace === undefined ? {} : { workspace: workspaceSettingsOf(member.workspace) }),
          ...(member.firstPrompt.trim() === '' ? {} : { firstPrompt: member.firstPrompt }),
          options: member.options,
          machineLabels: labelNamesOf(member, context),
          ...(member.mcpServers.length === 0 ? {} : { mcpServers: member.mcpServers }),
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

/** What a member's workspace may be picked from: every repository and folder an answering machine offers, for any harness. */
export function offeredWorkspacesOf(offers: readonly OfferedWorkspaces[]): OfferedWorkspaces {
  return { repositories: [...new Set(offers.flatMap((offer) => offer.repositories))], folders: [...new Set(offers.flatMap((offer) => offer.folders))] };
}
