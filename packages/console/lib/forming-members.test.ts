import { createIdGenerator, type ListedLabel, type ListedShip } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { mainRepository } from './crew-settings-form';
import { formMembersOf, labelErrorSlot, membersOf, missingOf, offeredWorkspacesOf, readyCount, withWorkspaceForAll, workspaceNoteOf, type MemberDraft } from './forming-members';
import { countedIn } from './fixtures/labels.fixtures';
import { labelContextOf } from './labels';

const newId = createIdGenerator();
const REPO = 'github.com/tidewater-labs/squadron-templates';

const PLUGIN: ListedShip = {
  id: newId('ship'), name: 'trierarch-plugin', type: 'trierarch-plugin', kind: 'agent', status: 'crewed', startingPrompt: null, location: null, lastSeenAt: null, ping: null,
  scopes: [], labels: [], report: null, harness: null, model: null, activity: null, openAlertCount: 0, awaitingCrewSince: null, crewRequest: null, retiredAt: null, ownerShipId: null,
};
const OS: ListedLabel = { id: newId('label'), key: 'os', values: [{ id: newId('labelValue'), value: 'linux' }, { id: newId('labelValue'), value: 'macos' }], owner: { kind: 'ship', id: PLUGIN.id, name: PLUGIN.name } };
const LINUX = OS.values[0]?.id ?? '';
const CONTEXT = labelContextOf(countedIn([OS], []), { ships: [PLUGIN], isOperator: true });

function aDraft(overrides: Partial<MemberDraft> = {}): MemberDraft {
  return {
    slot: 'implementer-1',
    role: 'implementer',
    template: { repository: REPO, name: 'implementer', version: 1 },
    crew: { harness: 'claude-code', workspace: { kind: 'repositories', main: { repository: 'tidewater' }, subRepositories: [] }, options: { effort: 'high', model: 'claude-opus-5-5' }, machineLabels: [{ key: 'os', value: 'linux' }] },
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
      workspace: { kind: 'repositories', main: { repository: 'tidewater', ref: '' }, subRepositories: [] },
      firstPrompt: '',
      options: { effort: 'high', model: 'claude-opus-5-5' },
      machineLabels: [LINUX],
      unknownLabels: [],
      mcpServers: [],
      parameters: [],
    });
  });

  it('starts each member from the main repository and sub-repositories its files name, each at its branch (#1769)', () => {
    const [member] = membersOf(
      [aDraft({ crew: { options: {}, workspace: { kind: 'repositories', main: { repository: 'tidewater', ref: 'next' }, subRepositories: [{ repository: 'skills' }, { repository: 'tidewater-docs', ref: 'v3' }] } } })],
      CONTEXT,
    );

    expect(member?.workspace).toEqual({
      kind: 'repositories',
      main: { repository: 'tidewater', ref: 'next' },
      subRepositories: [
        { repository: 'skills', ref: '' },
        { repository: 'tidewater-docs', ref: 'v3' },
      ],
    });
  });

  it('starts each member with the MCP servers its files name', () => {
    const [member] = membersOf([aDraft({ crew: { options: {}, mcpServers: ['company-graph'] } })], CONTEXT);

    expect(member).toMatchObject({ mcpServers: ['company-graph'] });
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

    expect(readyCount(members, ['tidewater'])).toEqual({ ready: 1, total: 2 });
  });

  it('counts a member naming a repository no machine offers, or one twice, as not ready, and says why (#1769)', () => {
    const members = membersOf(
      [
        aDraft({ slot: 'implementer-1', crew: { options: {}, workspace: { kind: 'repositories', main: { repository: 'tidewater' }, subRepositories: [{ repository: 'harbour' }] } } }),
        aDraft({ slot: 'implementer-2', crew: { options: {}, workspace: { kind: 'repositories', main: { repository: 'tidewater' }, subRepositories: [{ repository: 'tidewater' }] } } }),
        aDraft({ slot: 'implementer-3', crew: { options: {}, workspace: { kind: 'repositories', main: { repository: 'tidewater' }, subRepositories: [{ repository: 'skills' }] } } }),
      ],
      CONTEXT,
    );

    const notes = members.map((member) => workspaceNoteOf(member, ['tidewater', 'skills']));

    expect(readyCount(members, ['tidewater', 'skills'])).toEqual({ ready: 1, total: 3 });
    expect(notes).toEqual(['No machine offers harbour.', 'A repository is named twice.', undefined]);
  });
});

describe('withWorkspaceForAll', () => {
  it('gives the workspace to every member without one, and leaves the others theirs', () => {
    const members = membersOf([aDraft(), aDraft({ slot: 'implementer-2', crew: { options: {} } })], CONTEXT);

    expect(withWorkspaceForAll(members, mainRepository('harbour')).map((member) => member.workspace)).toEqual([
      { kind: 'repositories', main: { repository: 'tidewater', ref: '' }, subRepositories: [] },
      { kind: 'repositories', main: { repository: 'harbour', ref: '' }, subRepositories: [] },
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
          workspace: { kind: 'repositories', main: { repository: 'tidewater' }, subRepositories: [] },
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

  it("gives forming each member's main repository and sub-repositories, a branch only where one is given (#1769)", () => {
    const [member] = membersOf([aDraft()], CONTEXT);
    if (member === undefined) {
      throw new Error('no member');
    }

    const workspace = { kind: 'repositories' as const, main: { repository: 'tidewater', ref: ' next ' }, subRepositories: [{ repository: 'skills', ref: '' }, { repository: 'tidewater-docs', ref: 'v3' }] };

    expect(formMembersOf([{ ...member, workspace }], CONTEXT)['implementer-1']?.crew.workspace).toEqual({
      kind: 'repositories',
      main: { repository: 'tidewater', ref: 'next' },
      subRepositories: [{ repository: 'skills' }, { repository: 'tidewater-docs', ref: 'v3' }],
    });
  });

  it('leaves out a harness left to the trierarch and an empty first prompt', () => {
    const [member] = membersOf([aDraft({ crew: { workspace: { kind: 'folder', name: 'notes' }, options: {} } })], CONTEXT);
    if (member === undefined) {
      throw new Error('no member');
    }

    expect(formMembersOf([member], CONTEXT)['implementer-1']?.crew).toEqual({ workspace: { kind: 'folder', name: 'notes' }, options: {}, machineLabels: [] });
  });

  it("gives forming each member's MCP servers when it names any", () => {
    const [member] = membersOf([aDraft()], CONTEXT);
    if (member === undefined) {
      throw new Error('no member');
    }

    expect(formMembersOf([{ ...member, mcpServers: ['company-graph', 'jira'] }], CONTEXT)['implementer-1']?.crew).toMatchObject({ mcpServers: ['company-graph', 'jira'] });
  });
});

describe('labelErrorSlot', () => {
  it('finds the member whose label forming refused, from the label the message names', () => {
    const members = membersOf([aDraft(), aDraft({ slot: 'tester-1', role: 'tester', crew: { options: {}, machineLabels: [{ key: 'os', value: 'macos' }] } })], CONTEXT);

    expect(labelErrorSlot('The fleet has no machine label os=macos, so nothing was formed', { members, context: CONTEXT })).toBe('tester-1');
    expect(labelErrorSlot('The squadron manager did not answer.', { members, context: CONTEXT })).toBeUndefined();
  });
});

describe('offeredWorkspacesOf (#1769)', () => {
  it('offers a member every repository and folder an answering machine offers, for any harness', () => {
    expect(offeredWorkspacesOf([{ repositories: ['tidewater', 'skills'], folders: ['notes'] }, { repositories: ['tidewater', 'harbour'], folders: ['website'] }])).toEqual({
      repositories: ['tidewater', 'skills', 'harbour'],
      folders: ['notes', 'website'],
    });
  });
});
