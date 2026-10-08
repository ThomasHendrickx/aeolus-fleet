/**
 * A member's crew request (#343; docs/squadrons.md, "Crew settings"): its
 * settings from its template, its blueprint role and the form, nearest wins,
 * with its first prompt's parameters filled and its machine labels as the
 * fleet's value ids. A member whose settings name no workspace gets no
 * request: it keeps its crew lines.
 */
import type { CrewSettings, LabelValueId } from '@aeolus-fleet/common';

import type { BlueprintVersion, CrewDraft, TemplateVersion } from '../catalogue/catalogue.js';
import { fillParameters, memberCrewOf, type MemberCrew } from '../catalogue/member-crew.js';
import type { FleetDoor, FleetRefusal } from '../management/ports.js';
import { err, ok, type Result } from '../shared/result.js';

/** What the form sets for one member: the nearest crew settings, and values for its template's parameters. */
export interface MemberForm {
  crew?: CrewDraft;
  parameters?: Readonly<Record<string, string>>;
}

/** The fleet's value id of each machine label, by its `key=value` name. */
export type MachineLabelIds = ReadonlyMap<string, LabelValueId>;

/** Why the machine labels did not resolve: a label the fleet does not define, or a refused call. */
export type ResolveRefusal = { kind: 'unknown-label'; label: string } | { kind: 'refused'; refusal: FleetRefusal };

function nameOf(label: { key: string; value: string }): string {
  return `${label.key}=${label.value}`;
}

/** A member's crew settings, the form's layer merged over its files' (options per key), its first prompt filled. */
export function formedCrewOf(member: { template: TemplateVersion; role: BlueprintVersion['roles'][number]; form?: MemberForm }): MemberCrew {
  const { crew, parameters } = memberCrewOf(member);
  const form = member.form?.crew ?? {};
  const merged: MemberCrew = { ...crew, ...form, options: { ...crew.options, ...form.options } };
  const values = { ...Object.fromEntries(parameters.flatMap(({ name, value }) => (value === null ? [] : [[name, value]]))), ...member.form?.parameters };
  return merged.firstPrompt === undefined ? merged : { ...merged, firstPrompt: fillParameters(merged.firstPrompt, values) };
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
