import { describe, expect, it } from 'vitest';

import { trierarchConfigurationSchema } from './configuration.js';

const SKIP_PERMISSIONS = '--dangerously-skip-permissions';

/** A configuration as the operator writes it in ~/.aeolus/trierarch/config.json. */
function aConfiguration(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    $schema: 'https://aeolus-fleet.dev/schemas/trierarch-config.json',
    caps: { ships: 8, running: 4 },
    repositories: { 'aeolus-fleet': { path: '/Users/thomas/Projects/aeolus-fleet' } },
    folders: { notes: { path: '/Users/thomas/notes' } },
    harnesses: {
      'claude-code': {
        flags: ['--remote-control'],
        options: {
          model: { values: { opus: ['--model', 'claude-opus-5-5'], sonnet: ['--model', 'claude-sonnet-5-5'] }, default: 'opus' },
          permissions: { values: { ask: [], skip: [SKIP_PERMISSIONS] }, default: 'ask' },
        },
      },
    },
    ...overrides,
  };
}

describe('the trierarch configuration', () => {
  it('takes caps, repositories and folders by name, and harnesses with their flags and named options', () => {
    expect(trierarchConfigurationSchema.safeParse(aConfiguration()).error).toBeUndefined();
  });

  it('takes a worktree root that moves the worktrees', () => {
    expect(trierarchConfigurationSchema.parse(aConfiguration({ worktreeRoot: '/Volumes/work/worktrees' })).worktreeRoot).toBe(
      '/Volumes/work/worktrees',
    );
  });

  it('leaves the worktree root out by default, so the trierarch uses its own', () => {
    expect(trierarchConfigurationSchema.parse(aConfiguration()).worktreeRoot).toBeUndefined();
  });

  it('runs its sessions on the host when it names no runtime (decision 0039)', () => {
    expect(trierarchConfigurationSchema.parse(aConfiguration()).runtime).toBeUndefined();
  });

  it('takes the host runtime', () => {
    expect(trierarchConfigurationSchema.parse(aConfiguration({ runtime: { kind: 'host' } })).runtime).toEqual({ kind: 'host' });
  });

  it('takes the container runtime with its binary and the memory and cpu caps of each session (decision 0039)', () => {
    const runtime = { kind: 'container', binary: 'podman', memory: '4g', cpus: 2 };

    expect(trierarchConfigurationSchema.parse(aConfiguration({ runtime })).runtime).toEqual(runtime);
  });

  it.each([
    ['no binary', { kind: 'container', memory: '4g', cpus: 2 }],
    ['no memory cap', { kind: 'container', binary: 'podman', cpus: 2 }],
    ['no cpu cap', { kind: 'container', binary: 'podman', memory: '4g' }],
    ['a memory cap that is no size', { kind: 'container', binary: 'podman', memory: 'plenty', cpus: 2 }],
    ['a memory cap of nothing', { kind: 'container', binary: 'podman', memory: '0g', cpus: 2 }],
    ['no cpus', { kind: 'container', binary: 'podman', memory: '4g', cpus: 0 }],
    ['the model token in it, which lives in a file of its own', { kind: 'container', binary: 'podman', memory: '4g', cpus: 2, token: 'sk-ant-oat01-secret' }],
    ['a runtime it does not know', { kind: 'vm' }],
  ])('refuses a container runtime with %s', (_label, runtime) => {
    expect(trierarchConfigurationSchema.safeParse(aConfiguration({ runtime })).success).toBe(false);
  });

  it.each(['512m', '4g', '4G', '1073741824'])('takes a memory cap of %s, as the runtime takes it', (memory) => {
    expect(trierarchConfigurationSchema.safeParse(aConfiguration({ runtime: { kind: 'container', binary: 'podman', memory, cpus: 1.5 } })).error).toBeUndefined();
  });

  it('refuses an unknown field', () => {
    expect(trierarchConfigurationSchema.safeParse(aConfiguration({ sandbox: true })).success).toBe(false);
  });

  it.each([
    ['no ships', { ships: 0, running: 1 }],
    ['a fraction', { ships: 2.5, running: 1 }],
  ])('refuses caps of %s', (_label, caps) => {
    expect(trierarchConfigurationSchema.safeParse(aConfiguration({ caps })).success).toBe(false);
  });

  it('refuses a repository name that is a path', () => {
    const repositories = { 'work/aeolus-fleet': { path: '/Users/thomas/Projects/aeolus-fleet' } };

    expect(trierarchConfigurationSchema.safeParse(aConfiguration({ repositories })).success).toBe(false);
  });

  it('takes skip-permissions among the flags every launch gets: no policy, the operator configures it', () => {
    const harnesses = { 'claude-code': { flags: [SKIP_PERMISSIONS], options: {} } };

    expect(trierarchConfigurationSchema.safeParse(aConfiguration({ harnesses })).error).toBeUndefined();
  });

  it('takes skip-permissions as the default value of an option', () => {
    const harnesses = { 'claude-code': { flags: [], options: { permissions: { values: { skip: [SKIP_PERMISSIONS] }, default: 'skip' } } } };

    expect(trierarchConfigurationSchema.safeParse(aConfiguration({ harnesses })).error).toBeUndefined();
  });

  it('refuses a default that is none of the option values', () => {
    const harnesses = { 'claude-code': { flags: [], options: { model: { values: { opus: ['--model', 'claude-opus-5-5'] }, default: 'haiku' } } } };

    expect(trierarchConfigurationSchema.safeParse(aConfiguration({ harnesses })).success).toBe(false);
  });
});
