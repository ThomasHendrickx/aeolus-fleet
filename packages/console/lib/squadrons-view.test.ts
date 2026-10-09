import { describe, expect, it } from 'vitest';

import type { ShipId } from '@aeolus-fleet/common';

import type { BlueprintVersion, Squadron, TemplateVersion } from './squadrons-schemas';
import { blueprintChoices, blueprintPath, blueprintsUsing, rolesText, squadronsText, templateChoices, thresholdsText, templatePath, checkInText, handoffsOf, handoffsText, healthCounts, memberCount, membersByRole, otherMembersOfRole, roleOptions, rolePreviews, shipsInSquadrons, silentMembers, squadronActionsOffered, squadronsFromBlueprint, stationCount, workCounts } from './squadrons-view';

const REPO = 'example.com/templates';
const awaitingFacts: Pick<Squadron['members'][number], 'health' | 'checkInMinutes' | 'crew'> = {
  health: 'not-on-station',
  checkInMinutes: 30,
  crew: { status: 'awaitingCrew', lastSeenAt: null, crewedSince: null },
};

function blueprint(name: string, version: number): BlueprintVersion {
  return {
    repository: REPO,
    name,
    version,
    commit: `c${String(version)}`,
    committedAt: '2026-10-01T09:00:00.000Z',
    description: `${name} v${String(version)}`,
    roles: [
      {
        name: 'planner',
        template: { repository: REPO, name: 'planner', version: 2 },
        count: 1,
      },
      {
        name: 'implementer',
        template: { repository: REPO, name: 'implementer', version: 3 },
        count: 2,
      },
    ],
    handoffs: [],
    memberNames: 'plain',
    file: `squadrons/blueprints/${name}.yaml`,
  };
}

const planner: TemplateVersion = {
  repository: REPO,
  name: 'planner',
  version: 2,
  commit: 'p2',
  committedAt: '2026-10-01T09:00:00.000Z',
  description: 'Plans.',
  checkInMinutes: 30,
  model: null,
  launchNote: null,
  charter: 'You plan.',
  handoffs: [],
  file: 'squadrons/templates/planner.yaml',
};

describe('the blueprints to form from', () => {
  it('groups each blueprint with its versions, newest first, in name order', () => {
    const choices = blueprintChoices({
      blueprints: [blueprint('hemma', 1), blueprint('aeolus', 3), blueprint('hemma', 2)],
    });

    expect(choices.map((choice) => [choice.name, choice.versions.map((each) => each.version)])).toEqual([
      ['aeolus', [3]],
      ['hemma', [2, 1]],
    ]);
  });
});

describe('the preview of forming', () => {
  it('names each role with its template version, count and check-in interval, unknown when the catalogue lacks the template', () => {
    expect(rolePreviews(blueprint('aeolus', 3), [planner])).toEqual([
      { role: 'planner', template: 'planner@2', count: 1, checkInMinutes: 30 },
      {
        role: 'implementer',
        template: 'implementer@3',
        count: 2,
        checkInMinutes: undefined,
      },
    ]);
  });

  it('counts every member', () => {
    expect(memberCount(blueprint('aeolus', 3))).toBe(3);
  });

  it.each([
    [30, 'every 30 min'],
    [120, 'every 2 h'],
    [90, 'every 90 min'],
  ])('says a check-in of %i minutes as "%s"', (minutes, text) => {
    expect(checkInText(minutes)).toBe(text);
  });
});

describe('a squadron', () => {
  const members = [
    { role: 'planner', onStationAt: '2026-10-01T09:05:00.000Z' },
    { role: 'implementer', onStationAt: null },
    { role: 'implementer', onStationAt: '2026-10-01T09:06:00.000Z' },
  ];

  it('counts its members on station', () => {
    expect(
      stationCount({
        members: members.map((member, index) => ({
          ...member,
          shipId: `shp_${String(index)}`,
          name: `m${String(index)}`,
          type: 't',
          model: { pinned: null, stated: null, isMismatch: false },
          ...awaitingFacts,
        })),
      }),
    ).toEqual({
      onStation: 2,
      total: 3,
    });
  });

  it('groups its members by role, in the order the roles first appear', () => {
    expect(membersByRole(members).map((group) => [group.role, group.members.length])).toEqual([
      ['planner', 1],
      ['implementer', 2],
    ]);
  });
});

describe('the ships in squadrons', () => {
  const shipIdOf = (name: string): ShipId => `shp_${name}`;
  const squadron = (id: string, state: 'forming' | 'disbanded') => ({
    id,
    state,
    flagship: { shipId: shipIdOf(`${id}-flagship`), name: id },
    members: [{ shipId: shipIdOf(`${id}-tester`), name: 'tester-k3x9', role: 'tester', type: `${id}:tester`, onStationAt: null, model: { pinned: null, stated: null, isMismatch: false }, ...awaitingFacts }],
  });

  it('names the squadron of each flagship and member, and each member\'s role', () => {
    const ships = shipsInSquadrons([squadron('team-a1b2c3', 'forming')]);

    expect(ships.get('shp_team-a1b2c3-flagship')).toEqual({ squadronId: 'team-a1b2c3', role: null });
    expect(ships.get('shp_team-a1b2c3-tester')).toEqual({ squadronId: 'team-a1b2c3', role: 'tester' });
  });

  it('leaves out the ships of a disbanded squadron', () => {
    expect(shipsInSquadrons([squadron('team-old', 'disbanded')]).size).toBe(0);
  });
});

describe('a blueprint page', () => {
  it('is at its name, with its repository and version in the query', () => {
    expect(blueprintPath({ repository: 'github.com/acme/templates', name: 'hemma-feature', version: 4 })).toBe(
      '/squadrons/blueprints/hemma-feature?repository=github.com%2Facme%2Ftemplates&version=4',
    );
    expect(blueprintPath({ repository: 'github.com/acme/templates', name: 'hemma-feature' })).toBe('/squadrons/blueprints/hemma-feature?repository=github.com%2Facme%2Ftemplates');
  });

  it('lists the squadrons formed from the blueprint, any version, and no other', () => {
    const formed = (id: string, blueprint: { name: string; version: number }) => ({ id, blueprint: { repository: REPO, ...blueprint, commit: 'c' } });

    expect(squadronsFromBlueprint([formed('a', { name: 'aeolus', version: 3 }), formed('b', { name: 'docs', version: 1 }), formed('c', { name: 'aeolus', version: 4 })], { repository: REPO, name: 'aeolus' }).map((each) => each.id)).toEqual(['a', 'c']);
  });
});

describe('member health', () => {
  const healths: Squadron['members'][number]['health'][] = ['silent', 'on-time', 'on-time', 'not-on-station'];
  const members = healths.map((health) => ({ health }));

  it('counts members per health, on time first, leaving out healths no member has', () => {
    expect(healthCounts(members)).toEqual([
      { health: 'on-time', count: 2 },
      { health: 'silent', count: 1 },
      { health: 'not-on-station', count: 1 },
    ]);
  });

  it('counts members standing down after silent ones, before those not on station', () => {
    expect(healthCounts([{ health: 'not-on-station' }, { health: 'standing-down' }, { health: 'silent' }])).toEqual([
      { health: 'silent', count: 1 },
      { health: 'standing-down', count: 1 },
      { health: 'not-on-station', count: 1 },
    ]);
  });

  it('finds the silent members of squadrons not disbanded', () => {
    const squadron = (id: string, state: Squadron['state']) => ({ id, state, members: members.map((member, index) => ({ ...member, name: `m${String(index)}` })) });

    expect(silentMembers([squadron('team-a', 'sailing'), squadron('team-b', 'disbanded')]).map((each) => [each.squadronId, each.member.name])).toEqual([['team-a', 'm0']]);
  });
});

describe('the roles a member can be added to', () => {
  it('names each role of the blueprint with its template, interval, members now (not retired) and in the blueprint', () => {
    const member = (role: string, status: string) => ({ role, crew: { status } });
    const squadron = { members: [member('implementer', 'crewed'), member('implementer', 'retired'), member('planner', 'crewed')] };

    expect(roleOptions(squadron, { blueprint: blueprint('aeolus', 3), templates: [planner] })).toEqual([
      { role: 'planner', template: 'planner@2', checkInMinutes: 30, now: 1, inBlueprint: 1 },
      { role: 'implementer', template: 'implementer@3', checkInMinutes: undefined, now: 1, inBlueprint: 2 },
    ]);
  });
});

describe('otherMembersOfRole', () => {
  it('names the members a removal leaves in the role, retired ones and other roles left out', () => {
    const member = (shipId: string, { role, status }: { role: string; status: string }) => ({ shipId, name: `${role}-${shipId}`, role, crew: { status } });
    const squadron = {
      members: [
        member('a', { role: 'tester', status: 'crewed' }),
        member('b', { role: 'tester', status: 'crewed' }),
        member('c', { role: 'tester', status: 'retired' }),
        member('d', { role: 'planner', status: 'crewed' }),
      ],
    };

    expect(otherMembersOfRole(squadron, 'a')).toEqual(['tester-b']);
  });
});

describe('the templates in the catalogue', () => {
  it('groups each template with its versions, newest first, in name order', () => {
    const tester = (version: number): TemplateVersion => ({ ...planner, name: 'tester', version, file: 'squadrons/templates/tester.yaml' });

    expect(templateChoices({ templates: [tester(1), planner, tester(4)] }).map((choice) => [choice.name, choice.versions.map((each) => each.version)])).toEqual([
      ['planner', [2]],
      ['tester', [4, 1]],
    ]);
  });

  it("opens a template's page by name, with its repository and version in the query", () => {
    expect(templatePath({ repository: REPO, name: 'tester', version: 4 })).toBe('/squadrons/templates/tester?repository=example.com%2Ftemplates&version=4');
  });

  it('finds the blueprint versions that run a template, any version or the one given', () => {
    const blueprints = [blueprint('aeolus', 3), { ...blueprint('docs', 1), roles: [] }];

    expect(blueprintsUsing(blueprints, { repository: REPO, name: 'planner' }).map((each) => each.name)).toEqual(['aeolus']);
    expect(blueprintsUsing(blueprints, { repository: REPO, name: 'planner', version: 1 })).toEqual([]);
  });
});

describe('the Blueprints tab', () => {
  it('says the roles with their counts', () => {
    expect(rolesText(blueprint('aeolus', 3))).toBe('planner, implementer ×2');
  });

  it('says the squadrons not disbanded, by state', () => {
    expect(squadronsText([{ state: 'sailing' }, { state: 'disbanded' }, { state: 'forming' }, { state: 'standing-down' }])).toBe('1 forming, 1 sailing, 1 standing down');
    expect(squadronsText([{ state: 'disbanded' }])).toBe('');
  });
});

describe('the late and silent thresholds', () => {
  it('says them from the check-in interval: late after one, silent after three', () => {
    expect(thresholdsText(10)).toBe('Late after 10 min, silent after 30 min');
    expect(thresholdsText(30)).toBe('Late after 30 min, silent after 1 h 30 min');
    expect(thresholdsText(60)).toBe('Late after 1 h, silent after 3 h');
  });
});

describe('the squadron header actions', () => {
  const operator = { canManage: true, canSend: true, hasRoles: true };

  it('offers everything while Sailing to the operator', () => {
    expect(squadronActionsOffered({ state: 'sailing' }, operator)).toEqual({ canAddMember: true, canMessageFlagship: true, canStandDown: true, canForceStandDown: true });
  });

  it('offers Message to the flagship and Force stand down while Forming, not Add member or Stand down', () => {
    expect(squadronActionsOffered({ state: 'forming' }, operator)).toEqual({ canAddMember: false, canMessageFlagship: true, canStandDown: false, canForceStandDown: true });
  });

  it('offers Message to the flagship and Force stand down while Standing down', () => {
    expect(squadronActionsOffered({ state: 'standing-down' }, operator)).toEqual({ canAddMember: false, canMessageFlagship: true, canStandDown: false, canForceStandDown: true });
  });

  it('offers nothing once Disbanded', () => {
    expect(squadronActionsOffered({ state: 'disbanded' }, operator)).toEqual({ canAddMember: false, canMessageFlagship: false, canStandDown: false, canForceStandDown: false });
  });

  it('offers no Add member without a role to add', () => {
    expect(squadronActionsOffered({ state: 'sailing' }, { ...operator, hasRoles: false }).canAddMember).toBe(false);
  });

  it('offers a viewer nothing: it neither manages the fleet nor sends', () => {
    expect(squadronActionsOffered({ state: 'sailing' }, { canManage: false, canSend: false, hasRoles: true })).toEqual({
      canAddMember: false,
      canMessageFlagship: false,
      canStandDown: false,
      canForceStandDown: false,
    });
  });
});

describe('the work the members report', () => {
  it('counts each state in the order working, idle, blocked, leaving out members without a report', () => {
    expect(workCounts([{ state: 'blocked' }, { state: 'working' }, null, { state: 'idle' }, { state: 'idle' }])).toEqual([
      { state: 'working', count: 1 },
      { state: 'idle', count: 2 },
      { state: 'blocked', count: 1 },
    ]);
  });

  it('leaves out states no member reports', () => {
    expect(workCounts([{ state: 'working' }, null])).toEqual([{ state: 'working', count: 1 }]);
  });
});

describe("a role's hand-offs", () => {
  const blueprint = {
    handoffs: [
      { role: 'planner', handoff: 'plan-ready', to: 'implementer' },
      { role: 'implementer', handoff: 'ready-for-test', to: 'tester' },
      { role: 'tester', handoff: 'on-fail', to: 'implementer' },
      { role: 'tester', handoff: 'on-pass', to: 'flagship' },
    ],
  };

  it('names the roles that hand off to it and where its own hand-offs go', () => {
    expect(handoffsOf(blueprint, 'tester')).toEqual({ from: ['implementer'], to: ['implementer', 'flagship'] });
  });

  it('names each role once', () => {
    expect(handoffsOf(blueprint, 'implementer')).toEqual({ from: ['planner', 'tester'], to: ['tester'] });
  });

  it('says them in words', () => {
    expect(handoffsText({ from: ['implementer'], to: ['implementer', 'flagship'] })).toBe('from implementer · to implementer, flagship');
  });

  it('says None for a role with no hand-offs', () => {
    expect(handoffsText({ from: [], to: [] })).toBe('None');
  });
});
