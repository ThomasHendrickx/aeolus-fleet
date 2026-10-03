import { describe, expect, it } from 'vitest';

import { assembleCatalogue } from './assemble-catalogue.js';
import type { SourceFile } from './ports.js';

const REPO = 'github.com/thomashendrickx/squadron-templates';
const AT = new Date('2026-10-03T08:00:00.000Z');

function template(tagged: { name: string; version: number }, content: unknown): SourceFile {
  return { repository: REPO, kind: 'template', ...tagged, commit: `c0ffee${String(tagged.version)}`, committedAt: AT, content };
}

function blueprint(tagged: { name: string; version: number }, content: unknown): SourceFile {
  return { repository: REPO, kind: 'blueprint', ...tagged, commit: `b1ue${String(tagged.version)}`, committedAt: AT, content };
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

describe('a ship template', () => {
  it('reads its description, check-in interval in minutes, pinned model, launch note, charter and hand-offs', () => {
    const { templates: read } = assembleCatalogue([template({ name: 'tester', version: 4 }, tester)]);

    expect(read).toEqual([
      {
        repository: REPO,
        name: 'tester',
        version: 4,
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
    const [read] = assembleCatalogue([template({ name: 'planner', version: 1 }, planner)]).templates;

    expect(read).toMatchObject({ model: null, launchNote: null, handoffs: [], checkInMinutes: 120 });
  });

  it.each([
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
    const { templates: read, problems } = assembleCatalogue([template({ name: 'tester', version: 4 }, content)]);

    expect(read).toEqual([]);
    expect(problems).toMatchObject([{ repository: REPO, kind: 'template', name: 'tester', version: 4 }]);
    expect(problems[0]?.message).toContain(field);
  });
});

describe('a squadron blueprint', () => {
  it('reads its roles with their template versions and counts, hand-offs, and plain member names', () => {
    const { blueprints, problems } = assembleCatalogue([...templates, blueprint({ name: 'hemma-feature', version: 4 }, hemmaFeature)]);

    expect(problems).toEqual([]);
    expect(blueprints).toEqual([
      {
        repository: REPO,
        name: 'hemma-feature',
        version: 4,
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

  it('may choose prefixed member names', () => {
    const [read] = assembleCatalogue([...templates, blueprint({ name: 'hemma-feature', version: 4 }, { ...hemmaFeature, memberNames: 'prefixed' })]).blueprints;

    expect(read?.memberNames).toBe('prefixed');
  });

  function problemsOf(content: unknown) {
    const { blueprints, problems } = assembleCatalogue([...templates, blueprint({ name: 'hemma-feature', version: 4 }, content)]);
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
