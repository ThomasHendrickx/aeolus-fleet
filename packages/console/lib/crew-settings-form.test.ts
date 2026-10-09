import { idSchema } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { byteSize, defaultValues, offersOf, settingsOf, settingsRows, valuesOf, withHarness } from './crew-settings-form';
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

describe('offersOf', () => {
  it('merges what the answering machines offer per harness: workspaces and option values, the first default kept', () => {
    const other = aMachine('mb02', {
      details: {
        harnesses: [{ harness: 'claude-code', options: { type: 'object', properties: { model: { enum: ['sonnet', 'haiku'], default: 'sonnet' } } }, flags: [] }],
        workspaces: { repositories: ['hemma'], folders: [] },
      },
    });

    expect(offersOf([aMachine('mc01'), other])).toEqual([
      { harness: 'claude-code', repositories: ['aeolus-fleet', 'hemma'], folders: ['notes'], options: [{ name: 'model', values: ['opus', 'sonnet', 'haiku'], defaultValue: 'opus' }] },
    ]);
  });

  it('leaves out silent machines and machines that never reported', () => {
    expect(offersOf([aMachine('mc01', { overrides: { isSilent: true } }), aMachine('mb02', { overrides: { details: null } })])).toEqual([]);
  });
});

/** A label value id, as machine labels hold them. */
const LINUX = 'lbv_01m3tbfspe96yf1rnr4ank9h1a';

describe('the form values', () => {
  const offers = offersOf([aMachine('mc01', { details: { harnesses: [CLAUDE, { harness: 'codex', options: {}, flags: [] }], workspaces: { repositories: [], folders: ['notes'] } } })]);

  it('start at the first harness, its first workspace and its options at their defaults', () => {
    expect(defaultValues(offers)).toEqual({ harness: 'claude-code', workspace: { kind: 'folder', name: 'notes' }, options: { model: 'opus' }, firstPrompt: '', squadron: '', machineLabels: [] });
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

  it('make no settings until a workspace is picked', () => {
    expect(settingsOf({ ...defaultValues(offers), workspace: undefined })).toBeUndefined();
  });

  it('fill from the settings a request holds, for Edit; anything else starts as a new form', () => {
    const held = { harness: 'codex', workspace: { kind: 'worktree', repository: 'hemma' }, options: { model: 'gpt-6' }, firstPrompt: 'Go', machineLabels: [LINUX] };

    expect(valuesOf(held, offers)).toEqual({ harness: 'codex', workspace: { kind: 'worktree', repository: 'hemma' }, options: { model: 'gpt-6' }, firstPrompt: 'Go', squadron: '', machineLabels: [LINUX] });
    expect(valuesOf({}, offers)).toEqual(defaultValues(offers));
  });

  it('fill a request without a harness with the first harness offered, as a trierarch crews it with its first (#343)', () => {
    expect(valuesOf({ workspace: { kind: 'folder', name: 'notes' }, options: {} }, offers).harness).toBe(defaultValues(offers).harness);
  });
});

describe('settingsRows', () => {
  it('shows a request’s settings as rows: harness, workspace, each option, the first prompt’s size and the squadron', () => {
    expect(settingsRows({ harness: 'claude-code', workspace: { kind: 'worktree', repository: 'aeolus-fleet' }, options: { model: 'opus' }, firstPrompt: 'x'.repeat(112) })).toEqual([
      { label: 'Harness', value: 'claude-code' },
      { label: 'Workspace', value: 'aeolus-fleet', meta: 'New worktree' },
      { label: 'model', value: 'opus', isMono: true },
      { label: 'First prompt', value: '112 B' },
      { label: 'Squadron', value: null, isMono: true },
    ]);
  });

  it('shows a request without a harness as taking its trierarch’s default (#343)', () => {
    expect(settingsRows({ workspace: { kind: 'folder', name: 'notes' }, options: {} })?.[0]).toEqual({ label: 'Harness', value: 'Trierarch default' });
  });

  it('is undefined for settings made without the plugin', () => {
    expect(settingsRows({})).toBeUndefined();
  });

  it('words sizes in bytes, then KB', () => {
    expect(byteSize(112)).toBe('112 B');
    expect(byteSize(1229)).toBe('1.2 KB');
    expect(byteSize(8192)).toBe('8 KB');
  });
});
