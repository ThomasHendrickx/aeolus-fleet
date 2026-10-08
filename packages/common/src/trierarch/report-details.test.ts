import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { trierarchReportDetailsSchema } from './report-details.js';

/** The example in docs/trierarch.md, "What a trierarch reports". */
function documentedDetails(): unknown {
  const docs = readFileSync(new URL('../../../../docs/trierarch.md', import.meta.url), 'utf8');
  const [, json = ''] = /```json trierarch report details\n([\s\S]*?)```/.exec(docs) ?? [];
  return JSON.parse(json);
}

describe('trierarchReportDetailsSchema', () => {
  it('takes the example in docs/trierarch.md', () => {
    const details = documentedDetails();

    expect(trierarchReportDetailsSchema.parse(details)).toEqual(details);
  });

  it('takes each harness with its version and when its models were last confirmed, or never (#365)', () => {
    const details = {
      harnesses: [
        { harness: 'claude-code', options: {}, flags: [], version: '2.1.293', modelsConfirmedAt: '2026-10-08T15:00:00.000Z' },
        { harness: 'codex', options: {}, flags: [], version: '0.160.1', modelsConfirmedAt: null },
      ],
      workspaces: { repositories: [], folders: [] },
      caps: { ships: 2, running: 1 },
      kept: [],
      orphans: [],
      version: '0.20.2',
    };

    expect(trierarchReportDetailsSchema.parse(details)).toEqual(details);
  });

  it('refuses a time its models were confirmed that is no ISO 8601 time (#365)', () => {
    const details = {
      harnesses: [{ harness: 'claude-code', options: {}, flags: [], version: '2.1.293', modelsConfirmedAt: 'yesterday' }],
      workspaces: { repositories: [], folders: [] },
      caps: { ships: 2, running: 1 },
      kept: [],
      orphans: [],
      version: '0.20.2',
    };

    expect(trierarchReportDetailsSchema.safeParse(details).success).toBe(false);
  });

  it('takes a trierarch with nothing kept and no orphans', () => {
    const details = {
      harnesses: [{ harness: 'codex', options: {}, flags: [] }],
      workspaces: { repositories: [], folders: ['notes'] },
      caps: { ships: 2, running: 1 },
      kept: [],
      orphans: [],
      version: '0.19.0',
    };

    expect(trierarchReportDetailsSchema.parse(details)).toEqual(details);
  });

  it('takes kept worktrees by their ship and repository, and orphans by their repository and name: never a path (#325)', () => {
    const details = {
      harnesses: [{ harness: 'codex', options: {}, flags: [] }],
      workspaces: { repositories: ['aeolus-fleet'], folders: [] },
      caps: { ships: 2, running: 1 },
      kept: [{ shipId: 'shp_01m473j7hp3x6gha0gzs1mnf88', repository: 'aeolus-fleet' }],
      orphans: [{ repository: 'aeolus-fleet', name: 'lookout' }],
      version: '0.20.0',
    };

    expect(trierarchReportDetailsSchema.parse(details)).toEqual(details);
  });

  it.each([
    ['a kept worktree with its path', { kept: [{ shipId: 'shp_01m473j7hp3x6gha0gzs1mnf88', repository: 'aeolus-fleet', path: '/Users/thomas/scout' }] }],
    ['an orphan with its path', { orphans: [{ repository: 'aeolus-fleet', name: 'lookout', path: '/Users/thomas/lookout' }] }],
    ['an orphan named by a path', { orphans: [{ repository: 'aeolus-fleet', name: '../lookout' }] }],
  ])('refuses %s: paths stay on the machine (#325)', (_, change) => {
    const details = { harnesses: [], workspaces: { repositories: [], folders: [] }, caps: { ships: 2, running: 1 }, kept: [], orphans: [], version: '0.20.0', ...change };

    expect(trierarchReportDetailsSchema.safeParse(details).success).toBe(false);
  });

  it('takes the flags a harness marks as risky, per harness (#326)', () => {
    const details = {
      harnesses: [{ harness: 'claude-code', options: {}, flags: ['--remote-control', '--dangerously-skip-permissions'], riskyFlags: ['--dangerously-skip-permissions'] }],
      workspaces: { repositories: [], folders: ['notes'] },
      caps: { ships: 2, running: 1 },
      kept: [],
      orphans: [],
      version: '0.20.0',
    };

    expect(trierarchReportDetailsSchema.parse(details)).toEqual(details);
  });

  it('takes the machine a trierarch runs on: its os and arch, for the trierarch plugin to label it (#102)', () => {
    const details = {
      harnesses: [{ harness: 'codex', options: {}, flags: [] }],
      workspaces: { repositories: [], folders: ['notes'] },
      caps: { ships: 2, running: 1 },
      kept: [],
      orphans: [],
      machine: { os: 'macos', arch: 'arm64' },
      version: '0.20.0',
    };

    expect(trierarchReportDetailsSchema.parse(details)).toEqual(details);
  });

  it('takes a machine whose os or arch is outside the known ones, left out', () => {
    const details = {
      harnesses: [{ harness: 'codex', options: {}, flags: [] }],
      workspaces: { repositories: [], folders: ['notes'] },
      caps: { ships: 2, running: 1 },
      kept: [],
      orphans: [],
      machine: { os: 'linux' },
      version: '0.20.0',
    };

    expect(trierarchReportDetailsSchema.parse(details)).toEqual(details);
  });

  it.each([
    ['an os outside the known ones', (details: Record<string, unknown>) => ({ ...details, machine: { os: 'freebsd' } })],
    ['an arch outside the known ones', (details: Record<string, unknown>) => ({ ...details, machine: { arch: 'x64' } })],
    ['an unknown field in the machine', (details: Record<string, unknown>) => ({ ...details, machine: { os: 'linux', site: 'home' } })],
    ['risky flags that are not a list of text', (details: Record<string, unknown>) => ({ ...details, harnesses: [{ harness: 'codex', options: {}, flags: [], riskyFlags: '--search' }] })],
    ['an unknown field', (details: Record<string, unknown>) => ({ ...details, entries: [] })],
    ['an unknown field in a harness', (details: Record<string, unknown>) => ({ ...details, harnesses: [{ harness: 'codex', options: {}, flags: [], adapterFlags: [] }] })],
    ['no version', (details: Record<string, unknown>) => ({ ...details, version: undefined })],
    ['a cap of no ships', (details: Record<string, unknown>) => ({ ...details, caps: { ships: 0, running: 1 } })],
    ['a path as a repository name', (details: Record<string, unknown>) => ({ ...details, workspaces: { repositories: ['../etc'], folders: [] } })],
  ])('refuses %s', (_label, change) => {
    const details = documentedDetails();
    if (typeof details !== 'object' || details === null || Array.isArray(details)) {
      throw new TypeError('the documented details are an object');
    }

    expect(trierarchReportDetailsSchema.safeParse(change({ ...details })).success).toBe(false);
  });
});
