import { describe, expect, it } from 'vitest';

import type { BlueprintVersion, TemplateVersion } from './squadrons-api';
import { blueprintChoices, checkInText, memberCount, membersByRole, rolePreviews, shipsInSquadrons, stationCount } from './squadrons-view';

const REPO = 'example.com/templates';

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
  const squadron = (id: string, state: 'forming' | 'disbanded') => ({
    id,
    state,
    flagship: { shipId: `shp_${id}-flagship`, name: id },
    members: [{ shipId: `shp_${id}-tester`, name: 'tester-k3x9', role: 'tester', type: `${id}:tester`, onStationAt: null, model: { pinned: null, stated: null, isMismatch: false } }],
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
