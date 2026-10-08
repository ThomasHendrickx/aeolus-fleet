import { describe, expect, it } from 'vitest';

import type { BlueprintVersion, TemplateVersion } from './catalogue.js';
import { fillParameters, memberCrewOf } from './member-crew.js';

const REPO = 'github.com/thomashendrickx/squadron-templates';
const AT = new Date('2026-10-03T08:00:00.000Z');

/** A template with the crew settings, model and parameters a test gives it. */
function aTemplate(overrides: Partial<TemplateVersion> = {}): TemplateVersion {
  return {
    repository: REPO,
    name: 'tester',
    version: 4,
    file: 'squadrons/templates/tester.yaml',
    commit: 'c0ffee4',
    committedAt: AT,
    description: 'Runs the end-to-end suite.',
    checkInMinutes: 30,
    model: null,
    launchNote: null,
    charter: 'You test the branch you are given and report to {{reports-to}}.',
    handoffs: [],
    crew: {},
    parameters: [],
    ...overrides,
  };
}

type Role = BlueprintVersion['roles'][number];

/** A blueprint role running the template, with what a test gives it. */
function aRole(overrides: Partial<Role> = {}): Role {
  return { name: 'tester', template: { repository: REPO, name: 'tester', version: 4 }, count: 1, model: null, crew: {}, parameters: {}, ...overrides };
}

describe("a member's crew settings, from its template and its blueprint role (#343)", () => {
  it("are the template's when the role sets none, its model written as options.model", () => {
    const template = aTemplate({
      model: 'claude-opus-5-5',
      crew: { harness: 'claude-code', workspace: { kind: 'worktree', repository: 'hemma' }, options: { effort: 'high' }, machineLabels: [{ key: 'os', value: 'linux' }] },
    });

    expect(memberCrewOf({ template, role: aRole() }).crew).toEqual({
      harness: 'claude-code',
      workspace: { kind: 'worktree', repository: 'hemma' },
      options: { effort: 'high', model: 'claude-opus-5-5' },
      machineLabels: [{ key: 'os', value: 'linux' }],
    });
  });

  it('take the nearest: each field the role sets replaces the template’s whole, its model too', () => {
    const template = aTemplate({
      model: 'claude-opus-5-5',
      crew: { harness: 'claude-code', workspace: { kind: 'worktree', repository: 'hemma' }, firstPrompt: 'Wait.', machineLabels: [{ key: 'os', value: 'linux' }, { key: 'arch', value: 'arm64' }] },
    });
    const role = aRole({ model: 'gpt-6-sol', crew: { harness: 'codex', workspace: { kind: 'folder', name: 'notes' }, machineLabels: [{ key: 'os', value: 'macos' }] } });

    expect(memberCrewOf({ template, role }).crew).toEqual({
      harness: 'codex',
      workspace: { kind: 'folder', name: 'notes' },
      firstPrompt: 'Wait.',
      options: { model: 'gpt-6-sol' },
      machineLabels: [{ key: 'os', value: 'macos' }],
    });
  });

  it('merge options per key: the role’s keys win, the template’s other keys stay', () => {
    const template = aTemplate({ crew: { options: { effort: 'high', permissionMode: 'acceptEdits' } } });
    const role = aRole({ crew: { options: { effort: 'low' } } });

    expect(memberCrewOf({ template, role }).crew.options).toEqual({ effort: 'low', permissionMode: 'acceptEdits' });
  });

  it('hold no setting neither file gives: options empty, the rest left out', () => {
    expect(memberCrewOf({ template: aTemplate(), role: aRole() }).crew).toEqual({ options: {} });
  });

  it("list the template's parameters with the value the role fills, and none for one it leaves for the form", () => {
    const template = aTemplate({
      parameters: [
        { name: 'reports-to', description: 'Whom the tester reports to' },
        { name: 'suite', description: 'Which suite to run' },
      ],
    });

    expect(memberCrewOf({ template, role: aRole({ parameters: { 'reports-to': 'implementer' } }) }).parameters).toEqual([
      { name: 'reports-to', description: 'Whom the tester reports to', value: 'implementer' },
      { name: 'suite', description: 'Which suite to run', value: null },
    ]);
  });
});

describe('filling parameters', () => {
  it('puts each value given in place of its {{name}}, every time it is used', () => {
    expect(fillParameters('Report to {{reports-to}}; ask {{reports-to}} first.', { 'reports-to': 'implementer' })).toBe('Report to implementer; ask implementer first.');
  });

  it('leaves a placeholder no value is given for, for the form to fill', () => {
    expect(fillParameters('Run {{suite}} for {{reports-to}}.', { 'reports-to': 'implementer' })).toBe('Run {{suite}} for implementer.');
  });
});
