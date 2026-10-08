import type { BlueprintVersion, CrewDraft, OptionValue, TemplateVersion } from './catalogue.js';

/** A member's crew settings, merged: every field its files give, and its options, empty when none do. */
export type MemberCrew = Omit<CrewDraft, 'options'> & { options: Record<string, OptionValue> };

/** A template's parameter, with the value its blueprint role fills; null when the form still has to. */
export interface MemberParameter {
  name: string;
  description: string;
  value: string | null;
}

/** The one key a model is written under in a request's options (#343, Q1). */
const MODEL_OPTION = 'model';

/**
 * A member's crew settings from its template and its blueprint role (#343;
 * docs/squadrons.md, "Crew settings"): nearest wins, so each field the role
 * sets replaces the template's whole, except options, which merge per key.
 * The model, the role's or else the template's, is written as
 * `options.model`. The template's parameters come with the values the role
 * fills; the form fills the rest, and sets the third layer, at forming.
 */
export function memberCrewOf(member: { template: TemplateVersion; role: BlueprintVersion['roles'][number] }): { crew: MemberCrew; parameters: MemberParameter[] } {
  const { template, role } = member;
  const model = role.model ?? template.model;
  const crew: MemberCrew = {
    ...template.crew,
    ...role.crew,
    options: { ...template.crew.options, ...role.crew.options, ...(model === null ? {} : { [MODEL_OPTION]: model }) },
  };
  const parameters = template.parameters.map((parameter) => ({ ...parameter, value: role.parameters[parameter.name] ?? null }));
  return { crew, parameters };
}

/** A text with each `{{name}}` given a value in its place; a placeholder without one stays, for the form to fill. */
export function fillParameters(text: string, values: Readonly<Record<string, string>>): string {
  return text.replaceAll(/\{\{([^{}]*)\}\}/g, (placeholder, name: string) => values[name] ?? placeholder);
}
