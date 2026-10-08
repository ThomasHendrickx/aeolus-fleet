/**
 * A member's crew request (#343; docs/squadrons.md, "Crew settings"): its
 * settings from its template, its blueprint role and the form, nearest wins,
 * with its first prompt's parameters filled and its machine labels as the
 * fleet's value ids. A member whose settings name no workspace gets no
 * request: it keeps its crew lines.
 */
import { FIRST_PROMPT_MAX_BYTES, type CrewSettings, type LabelValueId } from '@aeolus-fleet/common';

import { CHARTER_MAX_BYTES, type BlueprintVersion, type CrewDraft, type TemplateVersion } from '../catalogue/catalogue.js';
import { fillParameters, memberCrewOf, type MemberCrew } from '../catalogue/member-crew.js';
import type { FleetDoor, FleetRefusal } from '../management/ports.js';
import { err, ok, type Result } from '../shared/result.js';

/** What the form sets for one member: the nearest crew settings, and values for its template's parameters. */
export interface MemberForm {
  crew?: CrewDraft;
  parameters?: Readonly<Record<string, string>>;
}

/** The longest parameter value the form may give, in UTF-8 bytes (#371): plenty for a name or an area. */
export const PARAMETER_VALUE_MAX_BYTES = 1024;

const BYTES_PER_KB = 1024;
const utf8 = new TextEncoder();

/**
 * The text of a member that is over its limit once its parameters are
 * filled (#371), as the refusal names it: its charter over the template
 * limit, which keeps the role message within 64 KB, or its first prompt over
 * the crew request's. Undefined when both fit.
 */
export function overLimitOf(member: { template: TemplateVersion; crew: MemberCrew; parameters: Readonly<Record<string, string>> }): OverLimit | undefined {
  const isOver = (text: string, maxBytes: number): boolean => utf8.encode(text).byteLength > maxBytes;
  if (isOver(fillParameters(member.template.charter, member.parameters), CHARTER_MAX_BYTES)) {
    return { text: 'charter', maxKb: CHARTER_MAX_BYTES / BYTES_PER_KB };
  }
  if (member.crew.firstPrompt !== undefined && isOver(member.crew.firstPrompt, FIRST_PROMPT_MAX_BYTES)) {
    return { text: 'first prompt', maxKb: FIRST_PROMPT_MAX_BYTES / BYTES_PER_KB };
  }
  return undefined;
}

/** A member's text over its limit, and that limit in KB. */
export interface OverLimit {
  text: 'charter' | 'first prompt';
  maxKb: number;
}

/** The fleet's value id of each machine label, by its `key=value` name. */
export type MachineLabelIds = ReadonlyMap<string, LabelValueId>;

/** Why the machine labels did not resolve: a label the fleet does not define, or a refused call. */
export type ResolveRefusal = { kind: 'unknown-label'; label: string } | { kind: 'refused'; refusal: FleetRefusal };

function nameOf(label: { key: string; value: string }): string {
  return `${label.key}=${label.value}`;
}

/** A member's parameter values: its role's, with the form's over them. */
export function memberParametersOf(member: { role: BlueprintVersion['roles'][number]; form?: MemberForm }): Record<string, string> {
  return { ...member.role.parameters, ...member.form?.parameters };
}

/** A member's crew settings, the form's layer merged over its files' (options per key), its first prompt filled. */
export function formedCrewOf(member: { template: TemplateVersion; role: BlueprintVersion['roles'][number]; form?: MemberForm }): MemberCrew {
  const { crew } = memberCrewOf(member);
  const form = member.form?.crew ?? {};
  const merged: MemberCrew = { ...crew, ...form, options: { ...crew.options, ...form.options } };
  return merged.firstPrompt === undefined ? merged : { ...merged, firstPrompt: fillParameters(merged.firstPrompt, memberParametersOf(member)) };
}

/** The value id of every machine label the crews that get a request name, each looked up once. */
export async function resolveMachineLabels(door: FleetDoor, of: { crewToken: string; crews: readonly MemberCrew[] }): Promise<Result<MachineLabelIds, ResolveRefusal>> {
  const ids = new Map<string, LabelValueId>();
  const labels = of.crews.flatMap((crew) => (crew.workspace === undefined ? [] : (crew.machineLabels ?? [])));
  for (const label of labels) {
    if (!ids.has(nameOf(label))) {
      const found = await door.findLabelValue(of.crewToken, label);
      if (!found.isOk) {
        return err(found.error.code === 'NOT_FOUND' ? { kind: 'unknown-label', label: nameOf(label) } : { kind: 'refused', refusal: found.error });
      }
      ids.set(nameOf(label), found.value.valueId);
    }
  }
  return ok(ids);
}

/** The settings of a member's crew request; undefined when its crew settings name no workspace. */
export function crewSettingsOf(crew: MemberCrew, context: { squadronId: string; labels: MachineLabelIds }): CrewSettings | undefined {
  const { harness, workspace, firstPrompt, options, machineLabels } = crew;
  if (workspace === undefined) {
    return undefined;
  }
  return {
    ...(harness === undefined ? {} : { harness }),
    workspace,
    ...(firstPrompt === undefined ? {} : { firstPrompt }),
    options,
    squadron: context.squadronId,
    ...(machineLabels === undefined ? {} : { machineLabels: machineLabels.flatMap((label) => context.labels.get(nameOf(label)) ?? []) }),
  };
}
