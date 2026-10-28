import { describe, expect, it } from 'vitest';

import { trierarchReportDetailsSchema } from './report-details.js';

/** The example in aeolus-fleet-trierarch's docs/trierarch.md, "What a trierarch reports". */
function documentedDetails(): unknown {
  return {
    harnesses: [
      {
        harness: 'claude-code',
        options: {
          type: 'object',
          properties: { model: { enum: ['claude-opus-5-5', 'claude-sonnet-5-5'] }, effort: { enum: ['low', 'medium', 'high'] } },
          additionalProperties: false,
        },
        flags: ['--remote-control', '--dangerously-skip-permissions'],
        riskyFlags: ['--dangerously-skip-permissions'],
        version: '2.1.293',
        modelsConfirmedAt: '2026-10-08T15:00:00.000Z',
      },
    ],
    workspaces: { repositories: ['aeolus-fleet'], folders: ['notes'] },
    caps: { ships: 8, running: 4 },
    kept: [{ shipId: 'shp_01m473j7hp3x6gha0gzs1mnf88', repository: 'aeolus-fleet' }],
    orphans: [{ repository: 'aeolus-fleet', name: 'lookout' }],
    machine: { os: 'macos', arch: 'arm64' },
    runtime: 'host',
    load: {
      memory: { totalBytes: 68719476736, availableBytes: 21474836480 },
      swap: { totalBytes: 8589934592, usedBytes: 1073741824 },
      cpu: { cores: 12, loadAverage: 3.5 },
      disk: { totalBytes: 1000000000000, freeBytes: 250000000000 },
    },
    usage: {
      subscriptions: [
        {
          harness: 'claude-code',
          readAt: '2026-10-24T09:30:00.000Z',
          windows: [
            { windowMinutes: 300, usedPercent: 3, resetsAt: '2026-10-24T12:00:00.000Z' },
            { windowMinutes: 10080, usedPercent: 68, resetsAt: '2026-10-27T08:00:00.000Z' },
          ],
        },
      ],
      ships: [
        {
          shipId: 'shp_01m473j7hp3x6gha0gzs1mnf88',
          models: [
            { model: 'claude-opus-5-5', tokens: { input: 1200, output: 45000, cacheRead: 9800000, cacheWrite: 410000 }, estimatedCostUsd: 12.5 },
            { model: 'claude-haiku-5-5', tokens: { input: 300, output: 2000, cacheRead: 50000, cacheWrite: 20000 }, estimatedCostUsd: null },
          ],
        },
      ],
    },
    version: '0.31.0',
  };
}

describe('trierarchReportDetailsSchema', () => {
  it('takes the documented example', () => {
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

  it.each(['host', 'container'])('takes the session runtime the machine runs its sessions in, %s, as a fact (decision 0039)', (runtime) => {
    const details = { harnesses: [], workspaces: { repositories: [], folders: [] }, caps: { ships: 2, running: 1 }, kept: [], orphans: [], runtime, version: '0.25.0' };

    expect(trierarchReportDetailsSchema.parse(details)).toEqual(details);
  });

  it('refuses a session runtime it does not know', () => {
    const details = { harnesses: [], workspaces: { repositories: [], folders: [] }, caps: { ships: 2, running: 1 }, kept: [], orphans: [], runtime: 'vm', version: '0.25.0' };

    expect(trierarchReportDetailsSchema.safeParse(details).success).toBe(false);
  });

  it('takes the subscription windows exactly at 0 and 100 % used (#353)', () => {
    const details = {
      harnesses: [],
      workspaces: { repositories: [], folders: [] },
      caps: { ships: 2, running: 1 },
      kept: [],
      orphans: [],
      usage: {
        subscriptions: [
          {
            harness: 'codex',
            readAt: '2026-10-24T09:30:00.000Z',
            windows: [
              { windowMinutes: 300, usedPercent: 0, resetsAt: '2026-10-24T12:00:00.000Z' },
              { windowMinutes: 10080, usedPercent: 100, resetsAt: '2026-10-27T08:00:00.000Z' },
            ],
          },
        ],
        ships: [],
      },
      version: '0.31.0',
    };

    expect(trierarchReportDetailsSchema.parse(details)).toEqual(details);
  });

  it('takes the harnesses the trierarch cannot serve now, each with why, up to a reason of 280 characters (#1212)', () => {
    const details = {
      harnesses: [{ harness: 'claude-code', options: {}, flags: [] }],
      workspaces: { repositories: [], folders: [] },
      caps: { ships: 2, running: 1 },
      kept: [],
      orphans: [],
      notOffered: [
        { harness: 'codex', reason: 'its aeolus plugin is not installed (run aeolus-trierarch upgrade)' },
        { harness: 'gemini', reason: 'x'.repeat(280) },
      ],
      version: '0.31.0',
    };

    expect(trierarchReportDetailsSchema.parse(details)).toEqual(details);
  });

  it('takes a machine load that names no swap, as a platform may not say it (#400)', () => {
    const details = {
      harnesses: [],
      workspaces: { repositories: [], folders: [] },
      caps: { ships: 2, running: 1 },
      kept: [],
      orphans: [],
      load: { memory: { totalBytes: 1024, availableBytes: 0 }, cpu: { cores: 1, loadAverage: 0 }, disk: { totalBytes: 1024, freeBytes: 0 } },
      version: '0.31.0',
    };

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
    ['a harness not offered without its reason', (details: Record<string, unknown>) => ({ ...details, notOffered: [{ harness: 'codex' }] })],
    ['a harness not offered with an empty reason', (details: Record<string, unknown>) => ({ ...details, notOffered: [{ harness: 'codex', reason: '' }] })],
    ['a harness not offered with a reason over 280 characters', (details: Record<string, unknown>) => ({ ...details, notOffered: [{ harness: 'codex', reason: 'x'.repeat(281) }] })],
    ['a negative amount of available memory', (details: Record<string, unknown>) => ({ ...details, load: { memory: { totalBytes: 1024, availableBytes: -1 }, cpu: { cores: 1, loadAverage: 0 }, disk: { totalBytes: 1024, freeBytes: 0 } } })],
    ['a machine with no cores', (details: Record<string, unknown>) => ({ ...details, load: { memory: { totalBytes: 1024, availableBytes: 0 }, cpu: { cores: 0, loadAverage: 0 }, disk: { totalBytes: 1024, freeBytes: 0 } } })],
    ['an unknown field in the load', (details: Record<string, unknown>) => ({ ...details, load: { memory: { totalBytes: 1024, availableBytes: 0 }, cpu: { cores: 1, loadAverage: 0 }, disk: { totalBytes: 1024, freeBytes: 0 }, gpu: {} } })],
    ['a subscription window used over 100 %', (details: Record<string, unknown>) => ({ ...details, usage: { subscriptions: [{ harness: 'codex', readAt: '2026-10-24T09:30:00.000Z', windows: [{ windowMinutes: 300, usedPercent: 101, resetsAt: '2026-10-24T12:00:00.000Z' }] }], ships: [] } })],
    ['a subscription read at a time that is no ISO 8601 time', (details: Record<string, unknown>) => ({ ...details, usage: { subscriptions: [{ harness: 'codex', readAt: 'just now', windows: [] }], ships: [] } })],
    ['a fraction of a token', (details: Record<string, unknown>) => ({ ...details, usage: { subscriptions: [], ships: [{ shipId: 'shp_01m473j7hp3x6gha0gzs1mnf88', models: [{ model: 'gpt-5.5', tokens: { input: 1.5, output: 0, cacheRead: 0, cacheWrite: 0 }, estimatedCostUsd: null }] }] } })],
    ['a negative estimated cost', (details: Record<string, unknown>) => ({ ...details, usage: { subscriptions: [], ships: [{ shipId: 'shp_01m473j7hp3x6gha0gzs1mnf88', models: [{ model: 'gpt-5.5', tokens: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 }, estimatedCostUsd: -1 }] }] } })],
    ['a path as a repository name', (details: Record<string, unknown>) => ({ ...details, workspaces: { repositories: ['../etc'], folders: [] } })],
  ])('refuses %s', (_label, change) => {
    const details = documentedDetails();
    if (typeof details !== 'object' || details === null || Array.isArray(details)) {
      throw new TypeError('the documented details are an object');
    }

    expect(trierarchReportDetailsSchema.safeParse(change({ ...details })).success).toBe(false);
  });

  describe('the logins sessions run on (aeolus-fleet-trierarch api keys K8)', () => {
    const SHIP = 'shp_01m473j7hp3x6gha0gzs1mnf88';
    const OTHER_SHIP = 'shp_01m473j7hp3x6gha0gzs1mnf89';
    const onLogins = (fields: { harnesses?: unknown[]; logins?: unknown; usage?: unknown }) => ({
      harnesses: [],
      workspaces: { repositories: [], folders: [] },
      caps: { ships: 2, running: 1 },
      kept: [],
      orphans: [],
      ...fields,
      version: '0.34.0',
    });

    it("takes each harness's default login and its key's state, since when it is not ready", () => {
      const details = onLogins({
        harnesses: [
          { harness: 'claude-code', options: {}, flags: [], login: { default: 'apiKey', key: 'outOfCredit', keyStateAt: '2026-10-28T14:02:00.000Z' } },
          { harness: 'codex', options: {}, flags: [], login: { default: 'subscription', key: 'none' } },
        ],
      });

      expect(trierarchReportDetailsSchema.parse(details)).toEqual(details);
    });

    it.each(['none', 'ready', 'refused', 'outOfCredit'])('takes the key state %s', (key) => {
      const details = onLogins({ harnesses: [{ harness: 'claude-code', options: {}, flags: [], login: { default: 'subscription', key } }] });

      expect(trierarchReportDetailsSchema.parse(details)).toEqual(details);
    });

    it('refuses a key state or a login it does not know', () => {
      const unknownState = onLogins({ harnesses: [{ harness: 'claude-code', options: {}, flags: [], login: { default: 'subscription', key: 'expired' } }] });
      const unknownLogin = onLogins({ harnesses: [{ harness: 'claude-code', options: {}, flags: [], login: { default: 'bedrock', key: 'none' } }] });

      expect(trierarchReportDetailsSchema.safeParse(unknownState).success).toBe(false);
      expect(trierarchReportDetailsSchema.safeParse(unknownLogin).success).toBe(false);
    });

    it('refuses a key in a harness\'s login: the key stays on the computer (K7)', () => {
      const details = onLogins({ harnesses: [{ harness: 'claude-code', options: {}, flags: [], login: { default: 'apiKey', key: 'ready', apiKey: 'test-key-not-real' } }] });

      expect(trierarchReportDetailsSchema.safeParse(details).success).toBe(false);
    });

    it('takes the login of each ship it crews, and the other one its next start would use', () => {
      const details = onLogins({
        logins: [
          { shipId: SHIP, login: 'apiKey' },
          { shipId: OTHER_SHIP, login: 'apiKey', next: 'subscription' },
        ],
      });

      expect(trierarchReportDetailsSchema.parse(details)).toEqual(details);
    });

    it('takes the tokens of each model split per login, so the cost on the key is the sum of its apiKey entries', () => {
      const tokens = { input: 100, output: 2000, cacheRead: 50000, cacheWrite: 1000 };
      const details = onLogins({
        usage: {
          subscriptions: [],
          ships: [
            {
              shipId: SHIP,
              models: [
                { model: 'claude-opus-5-5', login: 'subscription', tokens, estimatedCostUsd: 1.5 },
                { model: 'claude-opus-5-5', login: 'apiKey', tokens, estimatedCostUsd: 1.5 },
              ],
            },
          ],
        },
      });

      expect(trierarchReportDetailsSchema.parse(details)).toEqual(details);
    });
  });
});
