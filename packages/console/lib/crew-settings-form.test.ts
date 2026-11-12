import { idSchema, type CrewSettings, type LabelValueId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { addableSubRepositories, byteSize, defaultValues, offersOf, refusedSubRepository, settingsOf, settingsRows, valuesOf, withHarness, workspaceProblems } from './crew-settings-form';
import type { Machine } from './trierarch-plugin-schemas';

const CLAUDE = {
  harness: 'claude-code',
  options: { type: 'object', properties: { model: { enum: ['opus', 'sonnet'], default: 'opus' } }, additionalProperties: false },
  flags: [],
};

function aMachine(suffix: string, at: { details?: Partial<NonNullable<Machine['details']>>; overrides?: Partial<Machine> } = {}): Machine {
  const { details = {}, overrides = {} } = at;
  return {
    shipId: idSchema('ship').parse(`shp_01j9k2t4qzr3a9w6m2v5n7${suffix}`),
    name: `trierarch-${suffix}`,
    status: 'crewed',
    lastSeenAt: '2026-10-07T09:00:00.000Z',
    isSilent: false,
    report: null,
    details: { harnesses: [CLAUDE], workspaces: { repositories: ['aeolus-fleet'], folders: ['notes'] }, caps: { ships: 4, running: 2 }, kept: [], orphans: [], version: '0.19.0', ...details },
    ...overrides,
  };
}

/** A fleet that enables no model: every model is allowed. */
const NO_RULE: readonly string[] = [];

describe('offersOf', () => {
  it('merges what the answering machines offer per harness: workspaces and option values, the first default kept', () => {
    const other = aMachine('mb02', {
      details: {
        harnesses: [{ harness: 'claude-code', options: { type: 'object', properties: { model: { enum: ['sonnet', 'haiku'], default: 'sonnet' } } }, flags: [] }],
        workspaces: { repositories: ['hemma'], folders: [] },
      },
    });

    expect(offersOf([aMachine('mc01'), other], NO_RULE)).toEqual([
      { harness: 'claude-code', repositories: ['aeolus-fleet', 'hemma'], folders: ['notes'], options: [{ name: 'model', values: ['opus', 'sonnet', 'haiku'], defaultValue: 'opus' }], mcpServers: [] },
    ]);
  });

  it('offers the MCP servers any answering machine offers for the harness, a machine that reports none offering none', () => {
    const graph = aMachine('mc01', { details: { harnesses: [{ ...CLAUDE, mcpServers: ['company-graph'] }, { harness: 'codex', options: {}, flags: [], mcpServers: ['wiki'] }] } });
    const jira = aMachine('mb02', { details: { harnesses: [{ ...CLAUDE, mcpServers: ['jira', 'company-graph'] }] } });
    const older = aMachine('md03', { details: { harnesses: [CLAUDE] } });

    expect(offersOf([graph, jira, older], NO_RULE).map((offer) => [offer.harness, offer.mcpServers])).toEqual([
      ['claude-code', ['company-graph', 'jira']],
      ['codex', ['wiki']],
    ]);
  });

  it('leaves out silent machines and machines that never reported', () => {
    expect(offersOf([aMachine('mc01', { overrides: { isSilent: true } }), aMachine('mb02', { overrides: { details: null } })], NO_RULE)).toEqual([]);
  });
});

describe('offersOf in a fleet that enables models (model governance, M8)', () => {
  const THREE_MODELS = { ...CLAUDE, options: { type: 'object', properties: { model: { enum: ['opus', 'sonnet', 'haiku'], default: 'opus' }, effort: { enum: ['low', 'high'] } } } };
  const CODEX_WITHOUT_MODEL = { harness: 'codex', options: { type: 'object', properties: { effort: { enum: ['low', 'high'] } } }, flags: [] };
  const machine = aMachine('mc01', { details: { harnesses: [THREE_MODELS, CODEX_WITHOUT_MODEL] } });

  it('offers only the enabled models, at the reported default when it is enabled', () => {
    expect(offersOf([machine], ['sonnet', 'opus'])[0]?.options).toEqual([
      { name: 'model', values: ['opus', 'sonnet'], defaultValue: 'opus' },
      { name: 'effort', values: ['low', 'high'] },
    ]);
  });

  it('defaults to the first enabled model when the reported default is disabled', () => {
    expect(offersOf([machine], ['haiku', 'sonnet'])[0]?.options[0]).toEqual({ name: 'model', values: ['sonnet', 'haiku'], defaultValue: 'sonnet' });
  });

  it('leaves out a harness with no enabled model and a harness with no model option', () => {
    expect(offersOf([machine, aMachine('mb02')], ['claude-opus-5-5'])).toEqual([]);
  });

  it('offers a harness whose enabled model only one machine reports', () => {
    expect(offersOf([machine, aMachine('mb02')], ['haiku']).map((offer) => offer.harness)).toEqual(['claude-code']);
  });
});

describe('valuesOf in a fleet that enables models (model governance, M8)', () => {
  const held: CrewSettings = { harness: 'claude-code', workspace: { kind: 'folder', name: 'notes' }, options: { model: 'opus' } };

  it('offers the enabled default when editing a request whose model is now disabled', () => {
    const offers = offersOf([aMachine('mc01')], ['sonnet']);

    expect(valuesOf(held, { offers, enabledModels: ['sonnet'] }).options).toEqual({ model: 'sonnet' });
  });

  it('keeps the model a request holds while it is enabled', () => {
    const offers = offersOf([aMachine('mc01')], ['sonnet', 'opus']);

    expect(valuesOf(held, { offers, enabledModels: ['sonnet', 'opus'] }).options).toEqual({ model: 'opus' });
  });
});

/** A label value id, as machine labels hold them. */
const LINUX: LabelValueId = 'lbv_01m3tbfspe96yf1rnr4ank9h1a';

describe('the form values', () => {
  const offers = offersOf([aMachine('mc01', { details: { harnesses: [CLAUDE, { harness: 'codex', options: {}, flags: [] }], workspaces: { repositories: [], folders: ['notes'] } } })], NO_RULE);

  it('start at the first harness, its first workspace and its options at their defaults', () => {
    expect(defaultValues(offers)).toEqual({ harness: 'claude-code', workspace: { kind: 'folder', name: 'notes' }, options: { model: 'opus' }, firstPrompt: '', squadron: '', machineLabels: [], mcpServers: [] });
  });

  it('keep the workspace on another harness that offers it, with that harness’s options', () => {
    expect(withHarness(defaultValues(offers), { harness: 'codex', offers })).toMatchObject({ harness: 'codex', workspace: { kind: 'folder', name: 'notes' }, options: {} });
  });

  it('make crew settings, leaving out an empty first prompt, squadron and machine labels', () => {
    expect(settingsOf(defaultValues(offers))).toEqual({ harness: 'claude-code', workspace: { kind: 'folder', name: 'notes' }, options: { model: 'opus' } });
    expect(settingsOf({ ...defaultValues(offers), firstPrompt: 'Triage issues', squadron: 'hemma-feature' })).toMatchObject({ firstPrompt: 'Triage issues', squadron: 'hemma-feature' });
  });

  it('carry the machine labels picked into the settings, and keep them on another harness', () => {
    const picked = { ...defaultValues(offers), machineLabels: [LINUX] };

    expect(settingsOf(picked)).toMatchObject({ machineLabels: [LINUX] });
    expect(withHarness(picked, { harness: 'codex', offers })).toMatchObject({ machineLabels: [LINUX] });
  });

  it('carry the MCP servers picked into the settings, and keep them on another harness', () => {
    const picked = { ...defaultValues(offers), mcpServers: ['company-graph', 'jira'] };

    expect(settingsOf(picked)).toMatchObject({ mcpServers: ['company-graph', 'jira'] });
    expect(settingsOf(defaultValues(offers))).not.toHaveProperty('mcpServers');
    expect(withHarness(picked, { harness: 'codex', offers })).toMatchObject({ mcpServers: ['company-graph', 'jira'] });
  });

  it('make no settings until a workspace is picked', () => {
    expect(settingsOf({ ...defaultValues(offers), workspace: undefined })).toBeUndefined();
  });

  it('fill from the settings a request holds, for Edit; settings that are none start a new form', () => {
    const held: CrewSettings = { harness: 'codex', workspace: { kind: 'repositories', main: { repository: 'hemma' }, subRepositories: [] }, options: { model: 'gpt-6' }, firstPrompt: 'Go', machineLabels: [LINUX], mcpServers: ['company-graph'] };

    expect(valuesOf(held, { offers, enabledModels: NO_RULE })).toEqual({ harness: 'codex', workspace: { kind: 'repositories', main: { repository: 'hemma', ref: '' }, subRepositories: [] }, options: { model: 'gpt-6' }, firstPrompt: 'Go', squadron: '', machineLabels: [LINUX], mcpServers: ['company-graph'] });
    expect(valuesOf(null, { offers, enabledModels: NO_RULE })).toEqual(defaultValues(offers));
  });

  it('fill a request without a harness with the first harness offered, as a trierarch crews it with its first (#343)', () => {
    expect(valuesOf({ workspace: { kind: 'folder', name: 'notes' }, options: {} }, { offers, enabledModels: NO_RULE }).harness).toBe(defaultValues(offers).harness);
  });
});

describe('a main repository and its sub-repositories in the form (#1761)', () => {
  const offers = offersOf([aMachine('mc01', { details: { workspaces: { repositories: ['aeolus-fleet', 'aeolus-fleet-trierarch', 'skills', 'hemma'], folders: ['notes'] } } })], NO_RULE);
  const repositories = (main: string, ...subRepositories: string[]) => ({
    kind: 'repositories' as const,
    main: { repository: main, ref: '' },
    subRepositories: subRepositories.map((repository) => ({ repository, ref: '' })),
  });

  it('a new request starts at the first repository as main, its default branch and none added', () => {
    expect(defaultValues(offers).workspace).toEqual(repositories('aeolus-fleet'));
  });

  it('makes settings naming the main repository and each sub-repository, a branch only where one is given', () => {
    const workspace = { kind: 'repositories' as const, main: { repository: 'aeolus-fleet', ref: 'design/ship-folder' }, subRepositories: [{ repository: 'aeolus-fleet-trierarch', ref: 'release/0.9' }, { repository: 'skills', ref: '' }] };

    expect(settingsOf({ ...defaultValues(offers), workspace })?.workspace).toEqual({
      kind: 'repositories',
      main: { repository: 'aeolus-fleet', ref: 'design/ship-folder' },
      subRepositories: [{ repository: 'aeolus-fleet-trierarch', ref: 'release/0.9' }, { repository: 'skills' }],
    });
  });

  it('fills Edit with the held main repository, its sub-repositories and their branches', () => {
    const held: CrewSettings = { harness: 'claude-code', workspace: { kind: 'repositories', main: { repository: 'aeolus-fleet', ref: 'design/ship-folder' }, subRepositories: [{ repository: 'skills' }] }, options: {} };

    expect(valuesOf(held, { offers, enabledModels: NO_RULE }).workspace).toEqual({ kind: 'repositories', main: { repository: 'aeolus-fleet', ref: 'design/ship-folder' }, subRepositories: [{ repository: 'skills', ref: '' }] });
  });

  it('Add sub-repository offers what the machines offer for the harness, less the main repository and those added', () => {
    expect(addableSubRepositories(repositories('aeolus-fleet', 'skills'), offers[0])).toEqual(['aeolus-fleet-trierarch', 'hemma']);
  });

  it('settings every machine offers have no problem', () => {
    expect(workspaceProblems(repositories('aeolus-fleet', 'skills'), offers[0])).toEqual({ subRepositories: [undefined] });
  });

  it('a sub-repository no machine offers says so under its row and turns Save off, the footer naming it', () => {
    expect(workspaceProblems(repositories('aeolus-fleet', 'skills', 'aeolus-website'), offers[0])).toEqual({
      subRepositories: [undefined, 'No machine offers aeolus-website. Remove it, or join a machine that has it.'],
      note: 'No machine offers aeolus-website.',
    });
  });

  it('a main repository no machine offers says so under Workspace and turns Save off', () => {
    expect(workspaceProblems(repositories('aeolus-website'), offers[0])).toEqual({
      main: 'No machine offers aeolus-website. Pick another workspace, or join a machine that has it.',
      subRepositories: [],
      note: 'No machine offers aeolus-website.',
    });
  });

  it('the main repository among the sub-repositories is shown on its row, never fixed, and Save is off', () => {
    expect(workspaceProblems(repositories('aeolus-fleet', 'skills', 'aeolus-fleet'), offers[0])).toEqual({
      subRepositories: [undefined, 'aeolus-fleet is the main repository. Remove it here.'],
      note: 'A repository is named twice.',
    });
  });

  it('a folder has no sub-repositories and no problem of them', () => {
    expect(workspaceProblems({ kind: 'folder', name: 'notes' }, offers[0])).toEqual({ subRepositories: [] });
  });

  it('the plugin’s refusal goes under the row of the sub-repository it names, else under Workspace', () => {
    const workspace = repositories('aeolus-fleet', 'aeolus-fleet-trierarch', 'skills');

    expect(refusedSubRepository('no trierarch offering claude-code has repository skills', workspace)).toBe(1);
    expect(refusedSubRepository('no trierarch offering claude-code has repository aeolus-fleet-trierarch', workspace)).toBe(0);
    expect(refusedSubRepository('no trierarch offering claude-code has repository aeolus-fleet', workspace)).toBeUndefined();
  });

  it('finds the sub-repository the refusal names in quotes or parentheses, never a name that only contains it', () => {
    const workspace = repositories('aeolus-fleet', 'aeolus-fleet-trierarch', 'skills');

    expect(refusedSubRepository("Repository 'skills' is unavailable", workspace)).toBe(1);
    expect(refusedSubRepository('Repository "skills" is unavailable', workspace)).toBe(1);
    expect(refusedSubRepository('Repository `aeolus-fleet-trierarch` is unavailable', workspace)).toBe(0);
    expect(refusedSubRepository('no trierarch has it (skills)', workspace)).toBe(1);
    expect(refusedSubRepository('no trierarch has repository [skills].', workspace)).toBe(1);
    expect(refusedSubRepository("Repository 'aeolus-fleet' is unavailable", workspace)).toBeUndefined();
    expect(refusedSubRepository('no trierarch has repository my-skills', workspace)).toBeUndefined();
    expect(refusedSubRepository('no trierarch has repository skills.old', workspace)).toBeUndefined();
  });
});

describe('settingsRows', () => {
  it('shows a request’s settings as rows: harness, main repository, sub-repositories, each option, its MCP servers, the first prompt’s size and the squadron', () => {
    expect(settingsRows({ harness: 'claude-code', workspace: { kind: 'repositories', main: { repository: 'aeolus-fleet' }, subRepositories: [] }, options: { model: 'opus' }, firstPrompt: 'x'.repeat(112) })).toEqual([
      { label: 'Harness', value: 'claude-code' },
      { label: 'Main repository', value: null, repositories: [{ repository: 'aeolus-fleet' }] },
      { label: 'Sub-repositories', value: null, repositories: [] },
      { label: 'model', value: 'opus', isMono: true },
      { label: 'MCP servers', value: null, isMono: true },
      { label: 'First prompt', value: '112 B' },
      { label: 'Squadron', value: null, isMono: true },
    ]);
  });

  it('shows the main repository and each sub-repository with its branch when it has one (#1761)', () => {
    const rows = settingsRows({
      workspace: { kind: 'repositories', main: { repository: 'aeolus-fleet', ref: 'design/ship-folder' }, subRepositories: [{ repository: 'aeolus-fleet-trierarch', ref: 'release/0.9' }, { repository: 'skills' }] },
      options: {},
    });

    expect(rows?.slice(1, 3)).toEqual([
      { label: 'Main repository', value: null, repositories: [{ repository: 'aeolus-fleet', ref: 'design/ship-folder' }] },
      { label: 'Sub-repositories', value: null, repositories: [{ repository: 'aeolus-fleet-trierarch', ref: 'release/0.9' }, { repository: 'skills' }] },
    ]);
  });

  it('keeps a folder workspace as one Workspace row (#1761)', () => {
    expect(settingsRows({ workspace: { kind: 'folder', name: 'notes' }, options: {} })?.[1]).toEqual({ label: 'Workspace', value: 'notes', meta: 'Folder, as it is' });
  });

  it('shows the MCP servers a request names in one row, in the order named', () => {
    const rows = settingsRows({ workspace: { kind: 'folder', name: 'notes' }, options: {}, mcpServers: ['company-graph', 'jira'] });

    expect(rows?.find((row) => row.label === 'MCP servers')).toEqual({ label: 'MCP servers', value: 'company-graph, jira', isMono: true });
  });

  it('shows a request without a harness as taking its trierarch’s default (#343)', () => {
    expect(settingsRows({ workspace: { kind: 'folder', name: 'notes' }, options: {} })?.[0]).toEqual({ label: 'Harness', value: 'Trierarch default' });
  });

  it('is undefined for settings made without the plugin', () => {
    expect(settingsRows(null)).toBeUndefined();
  });

  it('words sizes in bytes, then KB', () => {
    expect(byteSize(112)).toBe('112 B');
    expect(byteSize(1229)).toBe('1.2 KB');
    expect(byteSize(8192)).toBe('8 KB');
  });
});
