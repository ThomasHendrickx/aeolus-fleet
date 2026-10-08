import { createIdGenerator, type ListedLabel, type ListedShip } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { formMembersOf, labelErrorSlot, membersOf, missingOf, readyCount, withWorkspaceForAll, workspaceFromItem, workspaceItemsOf, type MemberDraft } from './forming-members';
import { labelContextOf } from './labels';

const newId = createIdGenerator();
const REPO = 'github.com/tidewater-labs/squadron-templates';

const PLUGIN: ListedShip = {
  id: newId('ship'), name: 'trierarch-plugin', type: 'trierarch-plugin', kind: 'agent', status: 'crewed', startingPrompt: null, location: null, lastSeenAt: null, ping: null,
  scopes: [], labels: [], report: null, harness: null, model: null, awaitingCrewSince: null, crewRequest: null, retiredAt: null,
};
const OS: ListedLabel = { id: newId('label'), key: 'os', values: [{ id: newId('labelValue'), value: 'linux' }, { id: newId('labelValue'), value: 'macos' }], owner: { id: PLUGIN.id, name: PLUGIN.name } };
const LINUX = OS.values[0]?.id ?? '';
const CONTEXT = labelContextOf([OS], { ships: [PLUGIN], isOperator: true });

function aDraft(overrides: Partial<MemberDraft> = {}): MemberDraft {
  return {
    slot: 'implementer-1',
    role: 'implementer',
    template: { repository: REPO, name: 'implementer', version: 1 },
    crew: { harness: 'claude-code', workspace: { kind: 'worktree', repository: 'tidewater' }, options: { effort: 'high', model: 'claude-opus-5-5' }, machineLabels: [{ key: 'os', value: 'linux' }] },
    parameters: [],
    ...overrides,
  };
}

describe('membersOf (#343)', () => {
  it("starts each member from its files: settings as merged, machine labels as the fleet's value ids", () => {
    const [member] = membersOf([aDraft()], CONTEXT);

    expect(member).toEqual({
      slot: 'implementer-1',
      role: 'implementer',
      template: 'implementer@1',
      harness: 'claude-code',
      workspace: { kind: 'worktree', repository: 'tidewater' },
      firstPrompt: '',
      options: { effort: 'high', model: 'claude-opus-5-5' },
      machineLabels: [LINUX],
      unknownLabels: [],
      parameters: [],
    });
  });

  it('keeps a machine label the fleet does not have apart, as key=value, for a warning', () => {
    const [member] = membersOf([aDraft({ crew: { options: {}, machineLabels: [{ key: 'os', value: 'windows' }, { key: 'site', value: 'home' }] } })], CONTEXT);

    expect(member).toMatchObject({ machineLabels: [], unknownLabels: ['os=windows', 'site=home'] });
  });

  it('starts a member with no harness, no workspace and a parameter its role left empty', () => {
    const [member] = membersOf([aDraft({ crew: { options: {} }, parameters: [{ name: 'area', description: 'The area', value: null }] })], CONTEXT);

    expect(member).toMatchObject({ harness: '', workspace: undefined, parameters: [{ name: 'area', description: 'The area', value: '' }] });
  });
});

describe('missingOf and readyCount', () => {
  it('names what a member still needs: a workspace, and every parameter left empty', () => {
    const [member] = membersOf([aDraft({ crew: { options: {} }, parameters: [{ name: 'area', description: 'The area', value: null }, { name: 'lead', description: 'Who leads', value: 'planner' }] })], CONTEXT);

    expect(member && missingOf(member)).toEqual(['workspace', 'area']);
  });

  it('counts the members that need nothing more', () => {
    const members = membersOf([aDraft(), aDraft({ slot: 'implementer-2', crew: { options: {} } })], CONTEXT);

    expect(readyCount(members)).toEqual({ ready: 1, total: 2 });
  });
});

describe('withWorkspaceForAll', () => {
  it('gives the workspace to every member without one, and leaves the others theirs', () => {
    const members = membersOf([aDraft(), aDraft({ slot: 'implementer-2', crew: { options: {} } })], CONTEXT);

    expect(withWorkspaceForAll(members, { kind: 'folder', name: 'notes' }).map((member) => member.workspace)).toEqual([
      { kind: 'worktree', repository: 'tidewater' },
      { kind: 'folder', name: 'notes' },
    ]);
  });
});

describe('formMembersOf', () => {
  it("gives forming each member's settings by slot, labels back as key and value, unknown ones too, and its parameters", () => {
    const [member] = membersOf([aDraft({ parameters: [{ name: 'area', description: 'The area', value: null }] })], CONTEXT);
    if (member === undefined) {
      throw new Error('no member');
    }

    expect(formMembersOf([{ ...member, firstPrompt: 'Go.', unknownLabels: ['site=home'], parameters: [{ name: 'area', description: 'The area', value: 'tides' }] }], CONTEXT)).toEqual({
      'implementer-1': {
        crew: {
          harness: 'claude-code',
          workspace: { kind: 'worktree', repository: 'tidewater' },
          firstPrompt: 'Go.',
          options: { effort: 'high', model: 'claude-opus-5-5' },
          machineLabels: [
            { key: 'os', value: 'linux' },
            { key: 'site', value: 'home' },
          ],
        },
        parameters: { area: 'tides' },
      },
    });
  });

  it('leaves out a harness left to the trierarch and an empty first prompt', () => {
    const [member] = membersOf([aDraft({ crew: { workspace: { kind: 'folder', name: 'notes' }, options: {} } })], CONTEXT);
    if (member === undefined) {
      throw new Error('no member');
    }

    expect(formMembersOf([member], CONTEXT)['implementer-1']?.crew).toEqual({ workspace: { kind: 'folder', name: 'notes' }, options: {}, machineLabels: [] });
  });
});

describe('labelErrorSlot', () => {
  it('finds the member whose label forming refused, from the label the message names', () => {
    const members = membersOf([aDraft(), aDraft({ slot: 'tester-1', role: 'tester', crew: { options: {}, machineLabels: [{ key: 'os', value: 'macos' }] } })], CONTEXT);

    expect(labelErrorSlot('The fleet has no machine label os=macos, so nothing was formed', { members, context: CONTEXT })).toBe('tester-1');
    expect(labelErrorSlot('The squadron manager did not answer.', { members, context: CONTEXT })).toBeUndefined();
  });
});

describe('workspaceItemsOf', () => {
  it("offers every machine's repositories and folders, and a file's workspace no machine offers yet", () => {
    const members = membersOf([aDraft({ crew: { workspace: { kind: 'worktree', repository: 'harbour' }, options: {} } })], CONTEXT);

    expect(workspaceItemsOf([{ repositories: ['tidewater'], folders: ['notes'] }, { repositories: ['tidewater'], folders: [] }], members)).toEqual({
      'worktree:tidewater': 'tidewater · new worktree',
      'folder:notes': 'notes · folder, as it is',
      'worktree:harbour': 'harbour · new worktree, no machine offers it yet',
    });
  });

  it('reads a workspace back from its item', () => {
    expect([workspaceFromItem('worktree:tidewater'), workspaceFromItem('folder:notes'), workspaceFromItem('')]).toEqual([{ kind: 'worktree', repository: 'tidewater' }, { kind: 'folder', name: 'notes' }, undefined]);
  });
});
