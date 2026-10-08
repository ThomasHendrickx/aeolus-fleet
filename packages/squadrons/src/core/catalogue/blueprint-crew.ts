import type { FleetId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { Catalogue, TemplateReference } from './catalogue.js';
import { memberCrewOf, type MemberCrew, type MemberParameter } from './member-crew.js';

/** One member a blueprint forms, by its slot (`<role>-<n>`, as forming names it), with its merged crew settings. */
export interface MemberCrewDraft {
  slot: string;
  role: string;
  template: TemplateReference;
  crew: MemberCrew;
  parameters: MemberParameter[];
}

export type BlueprintCrew = (fleetId: FleetId, blueprint: TemplateReference) => Result<MemberCrewDraft[], DomainError<'BLUEPRINT_NOT_FOUND'>>;

/**
 * Use case: each member a blueprint version forms, with its crew settings
 * merged from its template and its role and the parameters left to fill
 * (#343), so the forming form starts from them. Members are in role order,
 * numbered within their role from 1.
 */
export function createBlueprintCrew(deps: { catalogue: (fleetId: FleetId) => Catalogue }): BlueprintCrew {
  return (fleetId, reference) => {
    const { blueprints, templates } = deps.catalogue(fleetId);
    const { repository, name, version } = reference;
    const blueprint = blueprints.find((held) => held.repository === repository && held.name === name && held.version === version);
    if (!blueprint) {
      return refuse('BLUEPRINT_NOT_FOUND', `The catalogue holds no blueprint ${name}@${String(version)} of ${repository}`);
    }
    const members: MemberCrewDraft[] = [];
    for (const role of blueprint.roles) {
      const template = templates.find((held) => held.repository === role.template.repository && held.name === role.template.name && held.version === role.template.version);
      if (!template) {
        return refuse('BLUEPRINT_NOT_FOUND', `The catalogue holds no template ${role.template.name}@${String(role.template.version)} for the role ${role.name}`);
      }
      const { crew, parameters } = memberCrewOf({ template, role });
      for (let number = 1; number <= role.count; number += 1) {
        members.push({ slot: `${role.name}-${String(number)}`, role: role.name, template: role.template, crew, parameters });
      }
    }
    return ok(members);
  };
}
