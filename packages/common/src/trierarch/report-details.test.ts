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

  it.each([
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
