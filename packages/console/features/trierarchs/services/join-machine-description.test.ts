import { describe, expect, it } from 'vitest';

import type { JoinMachineInput } from '../../../lib/join-machine-input';
import { joinMachineDescription } from './join-machine-description';

const sentence = (actions: string, asks: string) =>
  `Run this line in a terminal on the machine. It installs ${actions}. ${asks} It ends with a report of how it went.`;

const named = (overrides: Partial<JoinMachineInput>): JoinMachineInput => ({ name: 'laptop', ...overrides });

describe('joinMachineDescription, texts not on the boards', () => {
  it.each([
    [['claude-code'], 'the aeolus-fleet plugin for Claude Code'],
    [['codex'], 'the aeolus-fleet plugin for Codex'],
    [['copilot'], 'the aeolus-fleet plugin for Copilot'],
    [['claude-code', 'copilot'], 'the aeolus-fleet plugin for Claude Code and Copilot'],
    [['codex', 'copilot'], 'the aeolus-fleet plugin for Codex and Copilot'],
    [['claude-code', 'codex', 'copilot'], 'the aeolus-fleet plugin for Claude Code, Codex, and Copilot'],
  ] as const)('names the plugin for harnesses %j', (harnesses, plugin) => {
    const description = joinMachineDescription(named({ harnesses: [...harnesses], repositories: { kind: 'none' } }));

    expect(description).toBe(sentence(`the trierarch and ${plugin}, adds no repositories, and starts the trierarch`, 'It asks nothing.'));
  });

  it.each([
    [{ kind: 'folder', path: '~/code' }, 'adds every repository directly in ~/code'],
    [{ kind: 'none' }, 'adds no repositories'],
    [{ kind: 'list', entries: [] }, 'adds 0 repositories'],
    [{ kind: 'list', entries: ['a/one'] }, 'adds 1 repository'],
    [{ kind: 'list', entries: ['a/one', 'a/two'] }, 'adds 2 repositories'],
  ] as const)('describes repositories %j', (repositories, action) => {
    const description = joinMachineDescription(named({ harnesses: ['codex'], repositories: structuredClone(repositories) as JoinMachineInput['repositories'] }));

    expect(description).toBe(sentence(`the trierarch and the aeolus-fleet plugin for Codex, ${action}, and starts the trierarch`, 'It asks nothing.'));
  });

  it('says the machine asks for the harnesses when only the harnesses are left out', () => {
    const description = joinMachineDescription(named({ repositories: { kind: 'none' } }));

    expect(description).toBe(
      sentence('the trierarch and the aeolus-fleet plugin for each harness you pick, adds no repositories, and starts the trierarch', 'It asks on the machine for the harnesses.'),
    );
  });

  it('says the machine asks for the repositories when only the repositories are left out', () => {
    const description = joinMachineDescription(named({ harnesses: ['claude-code'] }));

    expect(description).toBe(sentence('the trierarch, the aeolus-fleet plugin for Claude Code, and starts the trierarch', 'It asks on the machine for the repositories.'));
  });
});
