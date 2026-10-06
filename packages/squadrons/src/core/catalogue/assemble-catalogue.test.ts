import { describe, expect, it } from 'vitest';

import { assembleCatalogue } from './assemble-catalogue.js';
import { CHARTER_MAX_BYTES } from './catalogue.js';
import type { SourceFile, UnreadTag } from './ports.js';

const REPO = 'github.com/thomashendrickx/squadron-templates';
const AT = new Date('2026-10-03T08:00:00.000Z');

function template(tagged: { name: string; version: number }, content: unknown): SourceFile {
  return { repository: REPO, kind: 'template', ...tagged, file: `squadrons/templates/${tagged.name}.yaml`, commit: `c0ffee${String(tagged.version)}`, committedAt: AT, content };
}

function blueprint(tagged: { name: string; version: number }, content: unknown): SourceFile {
  return { repository: REPO, kind: 'blueprint', ...tagged, file: `squadrons/blueprints/${tagged.name}.yaml`, commit: `b1ue${String(tagged.version)}`, committedAt: AT, content };
}

/** The catalogue of the files and tags read from REPO, the one repository squadrons is given. */
function catalogueOf(files: SourceFile[], tags: UnreadTag[] = []) {
  return assembleCatalogue({ repositories: [REPO], files, tags });
}

const tester = {
  description: 'Runs the end-to-end suite on a branch and reports the result.',
  checkIn: '30m',
  model: 'claude-opus-5-5',
  launchNote: 'Start in the repository root.',
  charter: 'You test the branch you are given.',
  handoffs: { 'on-fail': 'The failing tests and their output', 'on-pass': 'The branch and the run that passed' },
};
const implementer = { description: 'Builds the feature.', checkIn: '1h', charter: 'You build.', handoffs: { done: 'The branch to test' } };
const planner = { description: 'Plans the feature.', checkIn: '2h', charter: 'You plan.' };

const hemmaFeature = {
  description: 'Plans, builds and tests one feature of Hemma.',
  roles: {
    planner: { template: `${REPO}#planner@1` },
    implementer: { template: `${REPO}#implementer@1`, count: 2 },
    tester: { template: `${REPO}#tester@4` },
  },
  handoffs: { 'tester.on-fail': 'implementer', 'tester.on-pass': 'flagship', 'implementer.done': 'tester' },
};

const templates = [template({ name: 'tester', version: 4 }, tester), template({ name: 'implementer', version: 1 }, implementer), template({ name: 'planner', version: 1 }, planner)];

describe('a version in the catalogue', () => {
  it('keeps the path of its file within its repository, for the template and the blueprint alike', () => {
    const { templates: held, blueprints } = catalogueOf([...templates, blueprint({ name: 'hemma-feature', version: 4 }, hemmaFeature)]);

    expect(held.find((each) => each.name === 'tester')?.file).toBe('squadrons/templates/tester.yaml');
    expect(blueprints[0]?.file).toBe('squadrons/blueprints/hemma-feature.yaml');
  });
});

describe('a ship template', () => {
  it('reads its description, check-in interval in minutes, pinned model, launch note, charter and hand-offs', () => {
    const { templates: read } = catalogueOf([template({ name: 'tester', version: 4 }, tester)]);

    expect(read).toEqual([
      {
        repository: REPO,
        name: 'tester',
        version: 4,
        file: 'squadrons/templates/tester.yaml',
        commit: 'c0ffee4',
        committedAt: AT,
        description: tester.description,
        checkInMinutes: 30,
        model: 'claude-opus-5-5',
        launchNote: tester.launchNote,
        charter: tester.charter,
        handoffs: [
          { name: 'on-fail', carries: 'The failing tests and their output' },
          { name: 'on-pass', carries: 'The branch and the run that passed' },
        ],
      },
    ]);
  });

  it('has no model, no launch note and no hand-offs when it gives none', () => {
    const [read] = catalogueOf([template({ name: 'planner', version: 1 }, planner)]).templates;

    expect(read).toMatchObject({ model: null, launchNote: null, handoffs: [], checkInMinutes: 120 });
  });

  it('takes a charter of exactly 48 KB', () => {
    expect(catalogueOf([template({ name: 'tester', version: 4 }, { ...tester, charter: 'x'.repeat(CHARTER_MAX_BYTES) })]).templates).toHaveLength(1);
  });

  it.each([
    { label: 'a charter one byte over 48 KB', content: { ...tester, charter: 'x'.repeat(CHARTER_MAX_BYTES + 1) }, field: 'charter' },
    { label: 'a charter over 48 KB in UTF-8, though under it in characters', content: { ...tester, charter: 'é'.repeat(CHARTER_MAX_BYTES / 2 + 1) }, field: 'charter' },
    { label: 'no charter', content: { ...tester, charter: undefined }, field: 'charter' },
    { label: 'a check-in under a minute', content: { ...tester, checkIn: '0m' }, field: 'checkIn' },
    { label: 'a check-in over 24 hours', content: { ...tester, checkIn: '25h' }, field: 'checkIn' },
    { label: 'a check-in that is no duration', content: { ...tester, checkIn: 'often' }, field: 'checkIn' },
    { label: 'a hand-off name that is no handle', content: { ...tester, handoffs: { 'On Fail': 'x' } }, field: 'handoffs' },
    { label: 'content that is no mapping', content: 'just text', field: 'template' },
    { label: 'a model alias, not an exact model id', content: { ...tester, model: 'opus' }, field: 'model' },
    { label: 'a model that follows the latest release', content: { ...tester, model: 'claude-opus-latest' }, field: 'model' },
    { label: 'a model id with capitals', content: { ...tester, model: 'Claude-Opus-5-5' }, field: 'model' },
  ])('is left out with a problem when it has $label', ({ content, field }) => {
    const { templates: read, problems } = catalogueOf([template({ name: 'tester', version: 4 }, content)]);

    expect(read).toEqual([]);
    expect(problems).toMatchObject([{ repository: REPO, kind: 'template', name: 'tester', version: 4 }]);
    expect(problems[0]?.message).toContain(field);
  });
});

describe('a squadron blueprint', () => {
  it('reads its roles with their template versions and counts, hand-offs, and plain member names', () => {
    const { blueprints, problems } = catalogueOf([...templates, blueprint({ name: 'hemma-feature', version: 4 }, hemmaFeature)]);

    expect(problems).toEqual([]);
    expect(blueprints).toEqual([
      {
        repository: REPO,
        name: 'hemma-feature',
        version: 4,
        file: 'squadrons/blueprints/hemma-feature.yaml',
        commit: 'b1ue4',
        committedAt: AT,
        description: hemmaFeature.description,
        roles: [
          { name: 'planner', template: { repository: REPO, name: 'planner', version: 1 }, count: 1 },
          { name: 'implementer', template: { repository: REPO, name: 'implementer', version: 1 }, count: 2 },
          { name: 'tester', template: { repository: REPO, name: 'tester', version: 4 }, count: 1 },
        ],
        handoffs: [
          { role: 'tester', handoff: 'on-fail', to: 'implementer' },
          { role: 'tester', handoff: 'on-pass', to: 'flagship' },
          { role: 'implementer', handoff: 'done', to: 'tester' },
        ],
        memberNames: 'plain',
      },
    ]);
  });

  it('is named by its name field when it sets one, and keeps the path of its file', () => {
    const [read] = catalogueOf([...templates, blueprint({ name: 'team', version: 1 }, { ...hemmaFeature, name: 'hemma-feature' })]).blueprints;

    expect(read).toMatchObject({ name: 'hemma-feature', version: 1, file: 'squadrons/blueprints/team.yaml' });
  });

  it('names each version by its own file', () => {
    const { blueprints } = catalogueOf([...templates, blueprint({ name: 'team', version: 1 }, { ...hemmaFeature, name: 'hemma-feature' }), blueprint({ name: 'team', version: 2 }, { ...hemmaFeature, name: 'hemma-build' })]);

    expect(blueprints.map(({ name, version }) => `${name} v${String(version)}`)).toEqual(['hemma-feature v1', 'hemma-build v2']);
  });

  it('may choose prefixed member names', () => {
    const [read] = catalogueOf([...templates, blueprint({ name: 'hemma-feature', version: 4 }, { ...hemmaFeature, memberNames: 'prefixed' })]).blueprints;

    expect(read?.memberNames).toBe('prefixed');
  });

  function problemsOf(content: unknown) {
    const { blueprints, problems } = catalogueOf([...templates, blueprint({ name: 'hemma-feature', version: 4 }, content)]);
    expect(blueprints).toEqual([]);
    return problems.map((problem) => problem.message);
  }

  it.each([
    { label: 'a template version git has no tag for', content: { ...hemmaFeature, roles: { ...hemmaFeature.roles, tester: { template: `${REPO}#tester@9` } } }, message: /tester@9/ },
    { label: 'a template of a repository squadrons does not know', content: { ...hemmaFeature, roles: { ...hemmaFeature.roles, tester: { template: 'example.com/other#tester@4' } } }, message: /example\.com\/other/ },
    { label: 'a template reference that is no <repo>#<name>@<n>', content: { ...hemmaFeature, roles: { ...hemmaFeature.roles, tester: { template: `${REPO}#tester` } } }, message: /template/ },
    { label: 'a hand-off a template declares left unbound', content: { ...hemmaFeature, handoffs: { 'tester.on-fail': 'implementer', 'tester.on-pass': 'flagship' } }, message: /implementer\.done/ },
    { label: 'a binding of a hand-off no template declares', content: { ...hemmaFeature, handoffs: { ...hemmaFeature.handoffs, 'planner.done': 'tester' } }, message: /planner\.done/ },
    { label: 'a hand-off to a role it does not have', content: { ...hemmaFeature, handoffs: { ...hemmaFeature.handoffs, 'tester.on-pass': 'reviewer' } }, message: /reviewer/ },
    { label: 'a count over 20', content: { ...hemmaFeature, roles: { ...hemmaFeature.roles, implementer: { template: `${REPO}#implementer@1`, count: 21 } } }, message: /count/ },
    { label: 'no roles', content: { ...hemmaFeature, roles: {} }, message: /roles/ },
  ])('is left out with a problem when it has $label', ({ content, message }) => {
    const messages = problemsOf(content);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(message);
  });
});

describe('why a version is left out', () => {
  function reasonOf(files: SourceFile[], tags: UnreadTag[] = []): string | undefined {
    const { problems } = catalogueOf(files, tags);
    expect(problems).toHaveLength(1);
    return problems[0]?.message;
  }

  it('names a missing field and what it expects', () => {
    expect(reasonOf([template({ name: 'tester', version: 4 }, { ...tester, description: undefined })])).toBe('description is missing: expected one line of text');
  });

  it('names a field of the wrong kind and what it expects', () => {
    expect(reasonOf([template({ name: 'tester', version: 4 }, { ...tester, checkIn: 30 })])).toBe('checkIn must be a duration such as 30m or 2h');
  });

  it("names a blueprint's missing roles and what they hold", () => {
    expect(reasonOf([blueprint({ name: 'hemma-feature', version: 4 }, { description: 'A team.' })])).toBe('roles is missing: expected a mapping of role names, each to its template');
  });

  it('names a role whose name is no handle', () => {
    expect(reasonOf([...templates, blueprint({ name: 'hemma-feature', version: 4 }, { ...hemmaFeature, roles: { ...hemmaFeature.roles, Tester: { template: `${REPO}#tester@4` } } })])).toBe(
      'roles.Tester must be a handle: lowercase letters, digits, hyphens or colons',
    );
  });

  it("names a blueprint's name that is no handle", () => {
    expect(reasonOf([...templates, blueprint({ name: 'team', version: 1 }, { ...hemmaFeature, name: 'Hemma Feature' })])).toBe('name must be a handle: lowercase letters, digits, hyphens or colons');
  });

  it('leaves out every version of two blueprint files that give one name, and says which', () => {
    const { blueprints, problems } = catalogueOf([
      ...templates,
      blueprint({ name: 'team', version: 1 }, { ...hemmaFeature, name: 'hemma-feature' }),
      blueprint({ name: 'crew', version: 3 }, { ...hemmaFeature, name: 'hemma-feature' }),
    ]);

    expect(blueprints).toEqual([]);
    expect(problems).toEqual([
      { repository: REPO, kind: 'blueprint', name: 'team', version: 1, message: 'name hemma-feature is also the name of crew@3: every blueprint of a repository needs a name of its own' },
      { repository: REPO, kind: 'blueprint', name: 'crew', version: 3, message: 'name hemma-feature is also the name of team@1: every blueprint of a repository needs a name of its own' },
    ]);
  });

  it("leaves out a blueprint whose name is another blueprint file's name, and that blueprint too", () => {
    const { blueprints, problems } = catalogueOf([
      ...templates,
      blueprint({ name: 'hemma-feature', version: 4 }, hemmaFeature),
      blueprint({ name: 'team', version: 1 }, { ...hemmaFeature, name: 'hemma-feature' }),
    ]);

    expect(blueprints).toEqual([]);
    expect(problems.map(({ name, version }) => `${name}@${String(version)}`)).toEqual(['hemma-feature@4', 'team@1']);
  });

  it('says a file is no valid YAML, and where', () => {
    const file: SourceFile = { ...template({ name: 'tester', version: 4 }, undefined), parseError: 'Nested mappings are not allowed in compact mappings at line 2, column 10' };

    expect(reasonOf([file])).toBe('the template is no valid YAML: Nested mappings are not allowed in compact mappings at line 2, column 10');
  });

  it('says a blueprint references a template that is at no tag', () => {
    const content = { ...hemmaFeature, roles: { ...hemmaFeature.roles, reviewer: { template: `${REPO}#reviewer@1` } } };

    expect(reasonOf([...templates, blueprint({ name: 'hemma-feature', version: 4 }, content)])).toBe(`roles.reviewer.template: ${REPO} has no template reviewer at any tag`);
  });

  it('says a blueprint references a version that is not tagged, and which are', () => {
    const content = { ...hemmaFeature, roles: { ...hemmaFeature.roles, tester: { template: `${REPO}#tester@9` } } };

    expect(reasonOf([...templates, blueprint({ name: 'hemma-feature', version: 4 }, content)])).toBe(`roles.tester.template: ${REPO} has no tester@9, only tester@4`);
  });

  it('says a blueprint references a version that is left out itself', () => {
    const files = [template({ name: 'tester', version: 4 }, { ...tester, checkIn: 'often' }), ...templates.slice(1), blueprint({ name: 'hemma-feature', version: 4 }, hemmaFeature)];

    expect(catalogueOf(files).problems.map((problem) => problem.message)).toEqual([
      'checkIn must be a duration such as 30m or 2h',
      `roles.tester.template: ${REPO}#tester@4 is left out itself, for its own reason`,
    ]);
  });

  it('says a reference differs from a repository only in letter case, and that it must match exactly', () => {
    const content = { ...hemmaFeature, roles: { ...hemmaFeature.roles, tester: { template: 'github.com/ThomasHendrickx/squadron-templates#tester@4' } } };

    expect(reasonOf([...templates, blueprint({ name: 'hemma-feature', version: 4 }, content)])).toBe(
      `roles.tester.template: squadrons knows no repository github.com/ThomasHendrickx/squadron-templates; it knows ${REPO}, and a reference must match its name exactly, letter case too`,
    );
  });

  it('finds the templates of a repository it is given that holds no version yet', () => {
    const content = { ...hemmaFeature, roles: { ...hemmaFeature.roles, tester: { template: 'github.com/acme/empty#tester@1' } } };
    const { problems } = assembleCatalogue({ repositories: [REPO, 'github.com/acme/empty'], files: [...templates, blueprint({ name: 'hemma-feature', version: 4 }, content)], tags: [] });

    expect(problems.map((problem) => problem.message)).toEqual(['roles.tester.template: github.com/acme/empty has no template tester at any tag']);
  });

  it('says a tag points at a commit with no file of its name', () => {
    expect(catalogueOf([], [{ repository: REPO, tag: 'tester@3', path: '.aeolus/squadrons' }]).problems).toEqual([
      {
        repository: REPO,
        kind: 'tag',
        name: 'tester',
        version: 3,
        message: 'the tag tester@3 points at a commit with neither .aeolus/squadrons/templates/tester.yaml nor .aeolus/squadrons/blueprints/tester.yaml',
      },
    ]);
  });

  it('says a tag names no template or blueprint when its name is not lowercase', () => {
    expect(reasonOf([], [{ repository: REPO, tag: 'Tester@1', path: '.aeolus/squadrons' }])).toBe(
      'the tag Tester@1 names no template or blueprint: a version tag is <name>@<n>, its name in lowercase as the file is named, such as tester@1',
    );
  });

  it('gives no reason for a repository whose every file and tag is read', () => {
    expect(catalogueOf([...templates, blueprint({ name: 'hemma-feature', version: 4 }, hemmaFeature)]).problems).toEqual([]);
  });
});
