import { describe, expect, it } from 'vitest';

import { JOIN_HARNESSES, joinMachineInputSchema } from './join-machine-input';

describe('joinMachineInputSchema', () => {
  it('takes a name alone', () => {
    expect(joinMachineInputSchema.safeParse({ name: 'laptop' }).success).toBe(true);
  });

  it('takes every option', () => {
    const input = { name: 'laptop', harnesses: ['claude-code', 'copilot'], unattended: ['codex'], repositories: { kind: 'list', entries: ['/a', 'git@host:x/y.git'] } };
    expect(joinMachineInputSchema.parse(input)).toEqual(input);
  });

  it.each([
    ['no name', {}],
    ['an empty name', { name: '' }],
    ['a name that is no string', { name: 7 }],
    ['an unknown harness', { name: 'a', harnesses: ['vim'] }],
    ['an unknown unattended harness', { name: 'a', unattended: ['claude-chat'] }],
    ['an unknown repositories kind', { name: 'a', repositories: { kind: 'all' } }],
    ['a list without entries', { name: 'a', repositories: { kind: 'list' } }],
    ['a folder without a path', { name: 'a', repositories: { kind: 'folder' } }],
  ])('refuses %s', (_label, input) => {
    expect(joinMachineInputSchema.safeParse(input).success).toBe(false);
  });

  it('drops keys it does not know', () => {
    expect(joinMachineInputSchema.parse({ name: 'a', extra: 1 })).toEqual({ name: 'a' });
  });

  it('names the harnesses once', () => {
    expect(JOIN_HARNESSES).toEqual(['claude-code', 'codex', 'copilot']);
  });
});
