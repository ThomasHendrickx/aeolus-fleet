import { SHIP_HANDLE_MAX_LENGTH, SHIP_HANDLE_PATTERN } from '@aeolus-fleet/common';
import { z } from 'zod';

import { err, ok, type Result } from '../shared/result.js';
import { CHARTER_MAX_BYTES, FLAGSHIP, type BlueprintVersion, type Catalogue, type CatalogueProblem, type TemplateReference, type TemplateVersion } from './catalogue.js';
import type { SourceFile, UnreadTag } from './ports.js';

const MINUTES_PER_HOUR = 60;
const CHECK_IN_MAX_MINUTES = 24 * MINUTES_PER_HOUR;
const COUNT_MAX = 20;

/**
 * Why a field is refused, as the operator reads it after the field's name:
 * missing, or not what it must be.
 */
function expecting(expected: string): { error: (issue: { input?: unknown }) => string } {
  return { error: (issue) => (issue.input === undefined ? `is missing: expected ${expected}` : `must be ${expected}`) };
}

const HANDLE = 'a handle: lowercase letters, digits, hyphens or colons';
const handle = z.string().max(SHIP_HANDLE_MAX_LENGTH, `must be ${HANDLE}`).regex(SHIP_HANDLE_PATTERN, `must be ${HANDLE}`);
/** A mapping whose keys are handles; zod reports a refused key at the key's path. */
function handleRecord<T extends z.ZodType>(values: T, expected: string) {
  return z.record(handle, values, { error: (issue) => (issue.code === 'invalid_key' ? `must be ${HANDLE}` : expecting(expected).error(issue)) });
}
const text = (expected: string) => z.string(expecting(expected)).min(1, `must not be empty: expected ${expected}`);

const DURATION = 'a duration such as 30m or 2h';
/** `30m` or `2h`, from 1 minute to 24 hours, in minutes. */
const checkIn = z
  .string(expecting(DURATION))
  .regex(/^[1-9]\d*[mh]$/, `must be ${DURATION}`)
  .transform((raw) => Number(raw.slice(0, -1)) * (raw.endsWith('h') ? MINUTES_PER_HOUR : 1))
  .refine((minutes) => minutes <= CHECK_IN_MAX_MINUTES, 'must be at most 24h');

/** An exact model id, never an alias: `claude-opus-5-5`, not `opus` or `claude-opus-latest`. */
const model = z
  .string(expecting('an exact model id such as claude-opus-5-5'))
  .regex(/^[a-z0-9][a-z0-9.-]*$/, 'must be an exact model id: lowercase letters, digits, dots and hyphens')
  .refine((id) => /\d/.test(id) && !id.endsWith('-latest'), 'must be an exact model id, not an alias');

const templateSchema = z.object({
  description: text('one line of text'),
  checkIn,
  model: model.optional(),
  launchNote: z.string(expecting('text')).optional(),
  charter: text("the role's instructions as text").refine((charter) => new TextEncoder().encode(charter).length <= CHARTER_MAX_BYTES, 'must be at most 48 KB'),
  handoffs: handleRecord(text('what the hand-off carries'), 'a mapping of hand-off names, each to what it carries').optional(),
});

/** `<repository>#<name>@<n>`: a configured repository, a template's name, and its tag's version. */
const templateReference = z
  .string(expecting('<repository>#<name>@<n>'))
  .regex(/^[^#\s]+#[a-z0-9:-]+@[1-9]\d*$/, 'must be <repository>#<name>@<n>')
  .transform((raw): TemplateReference => {
    const [repository = '', rest = ''] = raw.split('#');
    const [name = '', version = ''] = rest.split('@');
    return { repository, name, version: Number(version) };
  });

const COUNT = `a whole number from 1 to ${String(COUNT_MAX)}`;
const ROLE_OR_FLAGSHIP = `a role of the blueprint or ${FLAGSHIP}`;
const blueprintSchema = z.object({
  name: handle.optional(),
  description: text('one line of text'),
  roles: handleRecord(
    z.object(
      { template: templateReference, count: z.int(expecting(COUNT)).min(1, `must be ${COUNT}`).max(COUNT_MAX, `must be ${COUNT}`).optional() },
      expecting('a mapping holding the role\'s template'),
    ),
    'a mapping of role names, each to its template',
  ).refine((roles) => Object.keys(roles).length > 0, 'must name at least one role'),
  handoffs: z
    .record(z.string().regex(/^[a-z0-9:-]+\.[a-z0-9:-]+$/), handle, {
      error: (issue) => (issue.code === 'invalid_key' ? 'must be <role>.<hand-off>' : expecting(`a mapping of <role>.<hand-off>, each to ${ROLE_OR_FLAGSHIP}`).error(issue)),
    })
    .optional(),
  memberNames: z.enum(['plain', 'prefixed'], expecting('plain or prefixed')).optional(),
});

/** The first problem zod found, as `<field> <why>`; the whole file when it is no mapping. */
function firstIssue(kind: SourceFile['kind'], error: z.ZodError): string {
  const [issue] = error.issues;
  const field = issue?.path.join('.') ?? '';
  return field === '' ? `the ${kind} must be a mapping of its fields` : `${field} ${issue?.message ?? 'is not valid'}`;
}

function templateOf(file: SourceFile): Result<TemplateVersion, string> {
  const parsed = templateSchema.safeParse(file.content);
  if (!parsed.success) {
    return err(firstIssue('template', parsed.error));
  }
  const { description, checkIn: checkInMinutes, model: pinned, launchNote, charter, handoffs } = parsed.data;
  const { repository, name, version, file: path, commit, committedAt } = file;
  return ok({
    repository,
    name,
    version,
    file: path,
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

/** A tag that names a version: a handle, `@`, and a whole number from 1. */
const VERSION_TAG = /^([a-z0-9:-]+)@([1-9]\d*)$/;
/** A tag shaped like a version tag, its name a handle or not. */
const VERSION_SHAPED_TAG = /^(.+)@([1-9]\d*)$/;

/** What a blueprint's references are checked against. */
interface Known {
  /** The templates in the catalogue, by reference. */
  templates: ReadonlyMap<string, TemplateVersion>;
  /** Every version a template file is tagged at, read or left out, by `<repository>#<name>`. */
  tagged: ReadonlyMap<string, readonly number[]>;
  /** The repositories squadrons is given, by name. */
  repositories: ReadonlySet<string>;
}

/** Why a reference finds no template in the catalogue; undefined when it finds one. */
function missingReason(reference: TemplateReference, known: Known): string | undefined {
  const { repository, name, version } = reference;
  if (!known.repositories.has(repository)) {
    const named = [...known.repositories].find((each) => each.toLowerCase() === repository.toLowerCase());
    return named === undefined
      ? `squadrons knows no repository ${repository}`
      : `squadrons knows no repository ${repository}; it knows ${named}, and a reference must match its name exactly, letter case too`;
  }
  if (known.templates.has(keyOf(reference))) {
    return undefined;
  }
  const versions = known.tagged.get(`${repository}#${name}`) ?? [];
  if (versions.length === 0) {
    return `${repository} has no template ${name} at any tag`;
  }
  if (versions.includes(version)) {
    return `${keyOf(reference)} is left out itself, for its own reason`;
  }
  const tags = versions.toSorted((one, other) => one - other).map((each) => `${name}@${String(each)}`);
  return `${repository} has no ${name}@${String(version)}, only ${tags.join(', ')}`;
}

function blueprintOf(file: SourceFile, known: Known): Result<BlueprintVersion, string> {
  const parsed = blueprintSchema.safeParse(file.content);
  if (!parsed.success) {
    return err(firstIssue('blueprint', parsed.error));
  }
  const { name: named, description, memberNames } = parsed.data;
  const roles = Object.entries(parsed.data.roles).map(([role, { template, count }]) => ({ name: role, template, count: count ?? 1 }));
  const roleNames = new Set(roles.map((role) => role.name));

  const declared = new Set<string>();
  for (const role of roles) {
    const missing = missingReason(role.template, known);
    const template = known.templates.get(keyOf(role.template));
    if (missing !== undefined || !template) {
      return err(`roles.${role.name}.template: ${missing ?? 'is no template'}`);
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

  const { repository, name, version, file: path, commit, committedAt } = file;
  return ok({ repository, name: named ?? name, version, file: path, commit, committedAt, description, roles, handoffs, memberNames: memberNames ?? 'plain' });
}

/** Why nothing was read at a version tag: its name is not lowercase, or its commit has no file of its name. */
function tagProblem(tag: UnreadTag): CatalogueProblem {
  const [, name = '', number = ''] = VERSION_SHAPED_TAG.exec(tag.tag) ?? [];
  const message = VERSION_TAG.test(tag.tag)
    ? `the tag ${tag.tag} points at a commit with neither ${tag.path}/templates/${name}.yaml nor ${tag.path}/blueprints/${name}.yaml`
    : `the tag ${tag.tag} names no template or blueprint: a version tag is <name>@<n>, its name in lowercase as the file is named, such as ${name.toLowerCase()}@${number}`;
  return { repository: tag.repository, kind: 'tag', name, version: Number(number), message };
}

/** Why a file is no valid YAML: the parser's first line, without the excerpt it adds below. */
function invalidYaml(file: SourceFile & { parseError: string }): string {
  return `the ${file.kind} is no valid YAML: ${file.parseError.split('\n')[0] ?? file.parseError}`;
}

/**
 * The catalogue from every tagged file of the repositories squadrons is given
 * (docs/squadrons.md): the template and blueprint versions that follow the
 * spec, and every version left out and version tag read nothing at, each with
 * its first problem, so the operator can fix it in git. A blueprint is
 * checked against the templates it references: every hand-off they declare
 * bound, and nothing bound they do not declare. Its name is its `name` field,
 * or its file name when it sets none; blueprint files of one repository that
 * give one name are all left out, as no one of them is that name.
 */
export function assembleCatalogue(read: { repositories: readonly string[]; files: readonly SourceFile[]; tags: readonly UnreadTag[] }): Catalogue {
  const problems: CatalogueProblem[] = read.tags.map(tagProblem);
  const problemOf = (file: SourceFile, message: string): CatalogueProblem => {
    const { repository, kind, name, version } = file;
    return { repository, kind, name, version, message };
  };

  const templates: TemplateVersion[] = [];
  const templateFiles = read.files.filter((each) => each.kind === 'template');
  for (const file of templateFiles) {
    const parsed = file.parseError === undefined ? templateOf(file) : err(invalidYaml({ ...file, parseError: file.parseError }));
    if (parsed.isOk) {
      templates.push(parsed.value);
    } else {
      problems.push(problemOf(file, parsed.error));
    }
  }

  const tagged = new Map<string, number[]>();
  for (const { repository, name, version } of templateFiles) {
    tagged.set(`${repository}#${name}`, [...(tagged.get(`${repository}#${name}`) ?? []), version]);
  }
  const known: Known = { templates: new Map(templates.map((template) => [keyOf(template), template])), tagged, repositories: new Set(read.repositories) };
  const followingSpec: { file: SourceFile; blueprint: BlueprintVersion }[] = [];
  for (const file of read.files.filter((each) => each.kind === 'blueprint')) {
    const parsed = file.parseError === undefined ? blueprintOf(file, known) : err(invalidYaml({ ...file, parseError: file.parseError }));
    if (parsed.isOk) {
      followingSpec.push({ file, blueprint: parsed.value });
    } else {
      problems.push(problemOf(file, parsed.error));
    }
  }

  const blueprints: BlueprintVersion[] = [];
  for (const { file, blueprint } of followingSpec) {
    const clashing = followingSpec.filter((other) => other.blueprint.repository === blueprint.repository && other.blueprint.name === blueprint.name && other.file.name !== file.name);
    if (clashing.length === 0) {
      blueprints.push(blueprint);
    } else {
      const tags = clashing.map((other) => `${other.file.name}@${String(other.file.version)}`);
      problems.push(problemOf(file, `name ${blueprint.name} is also the name of ${tags.join(', ')}: every blueprint of a repository needs a name of its own`));
    }
  }
  return { templates, blueprints, problems };
}
