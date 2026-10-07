import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { crewSettingsSchema } from './crew-settings.js';

/** The example in docs/trierarch.md, "The crew request". */
function documentedSettings(): Record<string, unknown> {
  const docs = readFileSync(new URL('../../../../docs/trierarch.md', import.meta.url), 'utf8');
  const [, json = ''] = /```json crew request settings\n([\s\S]*?)```/.exec(docs) ?? [];
  const parsed: unknown = JSON.parse(json);
  return typeof parsed === 'object' && parsed !== null ? { ...parsed } : {};
}

describe('crewSettingsSchema (decision 0027)', () => {
  it('takes the example in docs/trierarch.md', () => {
    const settings = documentedSettings();

    expect(crewSettingsSchema.parse(settings)).toEqual(settings);
  });

  it('takes the fixed core alone: a harness, a folder and no options', () => {
    const settings = { harness: 'codex', workspace: { kind: 'folder', name: 'notes' }, options: {} };

    expect(crewSettingsSchema.parse(settings)).toEqual(settings);
  });

  it.each([
    ['an unknown field', { flags: ['--yolo'] }],
    ['no harness', { harness: undefined }],
    ['a path as a repository', { workspace: { kind: 'worktree', repository: '/etc' } }],
    ['a first prompt that reads as a flag', { firstPrompt: '--dangerously-skip-permissions' }],
    ['a first prompt over 8 KB', { firstPrompt: 'x'.repeat(8 * 1024 + 1) }],
    ['no options', { options: undefined }],
  ])('refuses %s', (_label, change) => {
    expect(crewSettingsSchema.safeParse({ ...documentedSettings(), ...change }).success).toBe(false);
  });

  it('takes a first prompt of exactly 8 KB', () => {
    expect(crewSettingsSchema.safeParse({ ...documentedSettings(), firstPrompt: 'x'.repeat(8 * 1024) }).success).toBe(true);
  });
});
