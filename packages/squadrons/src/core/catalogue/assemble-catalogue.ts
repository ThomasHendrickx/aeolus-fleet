import { SHIP_HANDLE_MAX_LENGTH, SHIP_HANDLE_PATTERN } from '@aeolus-fleet/common';
import { z } from 'zod';

import { err, ok, type Result } from '../shared/result.js';
import { FLAGSHIP, type BlueprintVersion, type Catalogue, type CatalogueProblem, type TemplateReference, type TemplateVersion } from './catalogue.js';
import type { SourceFile } from './ports.js';

const MINUTES_PER_HOUR = 60;
const CHECK_IN_MAX_MINUTES = 24 * MINUTES_PER_HOUR;
const COUNT_MAX = 20;

const handle = z.string().max(SHIP_HANDLE_MAX_LENGTH).regex(SHIP_HANDLE_PATTERN, 'must be a handle: lowercase letters, digits, hyphens or colons');

/** `30m` or `2h`, from 1 minute to 24 hours, in minutes. */
const checkIn = z
  .string()
  .regex(/^[1-9]\d*[mh]$/, 'must be a duration such as 30m or 2h')
  .transform((raw) => Number(raw.slice(0, -1)) * (raw.endsWith('h') ? MINUTES_PER_HOUR : 1))
  .refine((minutes) => minutes <= CHECK_IN_MAX_MINUTES, 'must be at most 24h');

/** An exact model id, never an alias: `claude-opus-5-5`, not `opus` or `claude-opus-latest`. */
const model = z
  .string()
  .regex(/^[a-z0-9][a-z0-9.-]*$/, 'must be an exact model id: lowercase letters, digits, dots and hyphens')
  .refine((id) => /\d/.test(id) && !id.endsWith('-latest'), 'must be an exact model id, not an alias');

const templateSchema = z.object({
  description: z.string().min(1),
  checkIn,
  model: model.optional(),
  launchNote: z.string().optional(),
  charter: z.string().min(1),
  handoffs: z.record(handle, z.string().min(1)).optional(),
});

/** `<repository>#<name>@<n>`: a configured repository, a template's name, and its tag's version. */
const templateReference = z
  .string()
  .regex(/^[^#\s]+#[a-z0-9:-]+@[1-9]\d*$/, 'must be <repository>#<name>@<n>')
  .transform((raw): TemplateReference => {
    const [repository = '', rest = ''] = raw.split('#');
    const [name = '', version = ''] = rest.split('@');
    return { repository, name, version: Number(version) };
  });

const blueprintSchema = z.object({
  description: z.string().min(1),
  roles: z
    .record(handle, z.object({ template: templateReference, count: z.int().min(1).max(COUNT_MAX).optional() }))
    .refine((roles) => Object.keys(roles).length > 0, 'must name at least one role'),
  handoffs: z.record(z.string().regex(/^[a-z0-9:-]+\.[a-z0-9:-]+$/, 'must be <role>.<hand-off>'), handle).optional(),
  memberNames: z.enum(['plain', 'prefixed']).optional(),
});

/** The first problem zod found, as `<field>: <message>`; the whole file when it is no mapping. */
function firstIssue(kind: SourceFile['kind'], error: z.ZodError): string {
  const [issue] = error.issues;
  const field = issue?.path.join('.') ?? '';
  return field === '' ? `the ${kind} must be a mapping of its fields` : `${field}: ${issue?.message ?? 'is not valid'}`;
}

function templateOf(file: SourceFile): Result<TemplateVersion, string> {
  const parsed = templateSchema.safeParse(file.content);
  if (!parsed.success) {
    return err(firstIssue('template', parsed.error));
  }
  const { description, checkIn: checkInMinutes, model: pinned, launchNote, charter, handoffs } = parsed.data;
  const { repository, name, version, commit, committedAt } = file;
  return ok({
    repository,
    name,
    version,
    commit,
    committedAt,
    description,
    checkInMinutes,
    model: pinned ?? null,
    launchNote: launchNote ?? null,
    charter,
    handoffs: Object.entries(handoffs ?? {}).map(([handoff, carries]) => ({ name: handoff, carries })),
  });
}

function keyOf(reference: TemplateReference): string {
  return `${reference.repository}#${reference.name}@${String(reference.version)}`;
}

function blueprintOf(
  file: SourceFile,
  known: { templates: ReadonlyMap<string, TemplateVersion>; repositories: ReadonlySet<string> },
): Result<BlueprintVersion, string> {
  const parsed = blueprintSchema.safeParse(file.content);
  if (!parsed.success) {
    return err(firstIssue('blueprint', parsed.error));
  }
  const { description, memberNames } = parsed.data;
  const roles = Object.entries(parsed.data.roles).map(([role, { template, count }]) => ({ name: role, template, count: count ?? 1 }));
  const roleNames = new Set(roles.map((role) => role.name));

  const declared = new Set<string>();
  for (const role of roles) {
    if (!known.repositories.has(role.template.repository)) {
      return err(`roles.${role.name}.template: squadrons knows no repository ${role.template.repository}`);
    }
    const template = known.templates.get(keyOf(role.template));
    if (!template) {
      return err(`roles.${role.name}.template: ${role.template.repository} has no template ${role.template.name}@${String(role.template.version)}`);
    }
    for (const handoff of template.handoffs) {
      declared.add(`${role.name}.${handoff.name}`);
    }
  }

  const handoffs = Object.entries(parsed.data.handoffs ?? {}).map(([from, to]) => {
    const [role = '', handoff = ''] = from.split('.');
    return { role, handoff, to };
  });
  for (const { role, handoff, to } of handoffs) {
    if (!declared.has(`${role}.${handoff}`)) {
      return err(`handoffs: ${role}.${handoff} is a hand-off no template of the blueprint declares`);
    }
    if (to !== FLAGSHIP && !roleNames.has(to)) {
      return err(`handoffs: ${role}.${handoff} goes to ${to}, a role the blueprint does not have`);
    }
  }
  const unbound = [...declared].filter((from) => !handoffs.some(({ role, handoff }) => `${role}.${handoff}` === from));
  if (unbound.length > 0) {
    return err(`handoffs: ${unbound.join(', ')} must be bound to a role or the flagship`);
  }

  const { repository, name, version, commit, committedAt } = file;
  return ok({ repository, name, version, commit, committedAt, description, roles, handoffs, memberNames: memberNames ?? 'plain' });
}

/**
 * The catalogue from every tagged file (docs/squadrons.md): the template and
 * blueprint versions that follow the spec, and every version left out with its
 * first problem, so the operator can fix it in git. A blueprint is checked
 * against the templates it references: every hand-off they declare bound, and
 * nothing bound they do not declare.
 */
export function assembleCatalogue(files: readonly SourceFile[]): Catalogue {
  const problems: CatalogueProblem[] = [];
  const problemOf = (file: SourceFile, message: string): CatalogueProblem => {
    const { repository, kind, name, version } = file;
    return { repository, kind, name, version, message };
  };

  const templates: TemplateVersion[] = [];
  for (const file of files.filter((each) => each.kind === 'template')) {
    const read = file.parseError === undefined ? templateOf(file) : err(`the template is no valid YAML: ${file.parseError}`);
    if (read.isOk) {
      templates.push(read.value);
    } else {
      problems.push(problemOf(file, read.error));
    }
  }

  const known = {
    templates: new Map(templates.map((template) => [keyOf(template), template])),
    repositories: new Set(files.map((file) => file.repository)),
  };
  const blueprints: BlueprintVersion[] = [];
  for (const file of files.filter((each) => each.kind === 'blueprint')) {
    const read = file.parseError === undefined ? blueprintOf(file, known) : err(`the blueprint is no valid YAML: ${file.parseError}`);
    if (read.isOk) {
      blueprints.push(read.value);
    } else {
      problems.push(problemOf(file, read.error));
    }
  }
  return { templates, blueprints, problems };
}
