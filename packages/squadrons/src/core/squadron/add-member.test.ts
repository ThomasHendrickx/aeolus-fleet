import { idSchema, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { assert, beforeEach, describe, expect, it } from 'vitest';

import { issuedPrompt, MCP_URL, memberCrewLines } from '../../../test/support/management-fakes.js';
import { memoryAttempts } from '../../../test/support/memory-attempts.js';
import type { FleetDoor, ManagementCrew, ManagementCrewStore } from '../management/ports.js';
import { err, ok } from '../shared/result.js';
import { createAddMember } from './add-member.js';
import type { SquadronRepository } from './ports.js';
import type { Member, Squadron, SquadronState } from './squadron.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const MANAGEMENT: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h1a';
const TESTER: ShipId = 'shp_01m3tbfspe96yf1rnr4ank0002';
const FORMED = new Date('2026-10-03T09:00:00.000Z');
const NOW = new Date('2026-10-03T10:00:00.000Z');
const REPO = 'example.com/templates';

function aTester(): Member {
  return { shipId: TESTER, name: 'tester-k3x9', role: 'tester', type: 'team-a1b2c3:tester', onStationAt: FORMED, checkIn: null, standDownMessageId: null, stoodDownAt: null, retiredAt: null, releasingSince: null, parameters: {} };
}

function aSquadron(state: SquadronState, memberNames: 'plain' | 'prefixed' = 'plain'): Squadron {
  return {
    id: 'team-a1b2c3',
    fleetId: FLEET,
    state,
    blueprint: {
      repository: REPO,
      name: 'team',
      version: 1,
      file: 'squadrons/fixture.yaml', commit: 'b1',
      committedAt: FORMED,
      description: 'A team.',
      roles: [{ name: 'tester', template: { repository: REPO, name: 'tester', version: 4 }, count: 1, model: null, crew: {}, parameters: {} }],
      handoffs: [],
      memberNames,
    },
    templates: [
      { repository: REPO, name: 'tester', version: 4, file: 'squadrons/fixture.yaml', commit: 't4', committedAt: FORMED, description: 'Tests.', checkInMinutes: 30, model: 'claude-opus-5-5', launchNote: 'Start in the root.', charter: 'You test.', handoffs: [], crew: {}, parameters: [] },
    ],
    flagship: { shipId: 'shp_01m3tbfspe96yf1rnr4ank0000', name: 'team-a1b2c3', crewToken: 'aeolus_ct_v1_flagship' },
    members: [aTester()],
    formedAt: FORMED,
    sailedAt: FORMED,
  };
}

let held: Squadron;
let crew: ManagementCrew | undefined;
const attempts = memoryAttempts();
/** Every ship the fleet commissioned: name, type, whether retired. */
let commissioned: { shipId: ShipId; name: string; type: string; isRetired: boolean }[];
let isCommissionRefused: boolean;
/** Each ship's crew request settings, as the fleet holds them. */
let requests: Map<ShipId, unknown>;
let isCrewRequestRefused: boolean;
/** The machine labels the fleet defines, by `key=value`. */
const LABEL_VALUES = new Map([['os=macos', 'lbv_01m3tbfspe96yf1rnr4ank9h3a']]);
/** The attempt each update finished, if any. */
const finishedByUpdate: (string | undefined)[] = [];

const notUsed = () => Promise.resolve(err({ code: 'FORBIDDEN', message: 'not used' }));
const door: FleetDoor = {
  register: notUsed,
  whoami: notUsed,
  deregister: notUsed,
  getShip: notUsed,
  getStartingPrompt: notUsed,
  release: notUsed,
  listShips: notUsed,
  receive: notUsed,
  ack: notUsed,
  send: notUsed,
  commission: (crewToken, { name, type }) => {
    if (crewToken !== 'aeolus_ct_v1_management' || isCommissionRefused) {
      return Promise.resolve(err({ code: 'INTERNAL_SERVER_ERROR', message: 'Internal error' }));
    }
    const shipId: ShipId = `shp_01m3tbfspe96yf1rnr4ank${String(commissioned.length + 10).padStart(4, '0')}`;
    commissioned.push({ shipId, name, type, isRetired: false });
    return Promise.resolve(ok({ shipId, ...issuedPrompt(shipId, `aeolus_sk_v1_${name}`) }));
  },
  requestCrew: (_crewToken, { shipId, settings }) => {
    if (isCrewRequestRefused) {
      return Promise.resolve(err({ code: 'BAD_REQUEST', message: 'Settings are at most 16 KB' }));
    }
    requests.set(shipId, settings);
    return Promise.resolve(ok(undefined));
  },
  removeCrewRequest: notUsed,
  findLabelValue: (_crewToken, { key, value }) => {
    const valueId = LABEL_VALUES.get(`${key}=${value}`);
    return Promise.resolve(valueId === undefined ? err({ code: 'NOT_FOUND', message: 'No such label' }) : ok({ valueId: idSchema('labelValue').parse(valueId) }));
  },
  retire: (_crewToken, { shipId }) => {
    const ship = commissioned.find((each) => each.shipId === shipId);
    if (ship) {
      ship.isRetired = true;
    }
    return Promise.resolve(ok(undefined));
  },
};
const management: ManagementCrewStore = {
  find: (fleetId) => Promise.resolve(crew?.fleetId === fleetId ? crew : undefined),
  binding: (fleetId) => Promise.resolve(crew?.fleetId === fleetId ? { fleetId: crew.fleetId, shipId: crew.shipId } : undefined),
  connected: () => Promise.resolve(crew ? [crew] : []),
  save: () => Promise.resolve(),
  drop: () => Promise.resolve(),
};
const squadrons: SquadronRepository = {
  exists: () => Promise.resolve(true),
  create: () => Promise.resolve(),
  list: (fleetId) => Promise.resolve(fleetId === FLEET ? [structuredClone(held)] : []),
  update: ({ after, finishesAttempt }) => {
    held = structuredClone(after);
    finishedByUpdate.push(finishesAttempt);
    return Promise.resolve();
  },
};

const addMember = createAddMember({ door, management, squadrons, attempts, random: { suffix: () => 'q8r2' }, clock: { now: () => NOW }, mcpUrl: MCP_URL });

beforeEach(() => {
  held = aSquadron('sailing');
  crew = { fleetId: FLEET, shipId: MANAGEMENT, name: 'squadrons', crewToken: 'aeolus_ct_v1_management', crewedAt: FORMED };
  attempts.held.length = 0;
  commissioned = [];
  isCommissionRefused = false;
  requests = new Map();
  isCrewRequestRefused = false;
  finishedByUpdate.length = 0;
});

describe('adding a member', () => {
  it("commissions a member of the role from the squadron's own template version, and answers its crew lines, launch note and pinned model once", async () => {
    const added = await addMember({ fleetId: FLEET, squadronId: 'team-a1b2c3', role: 'tester' });

    expect(added).toEqual({
      isOk: true,
      value: {
        shipId: 'shp_01m3tbfspe96yf1rnr4ank0010',
        name: 'tester-q8r2',
        role: 'tester',
        crewLines: memberCrewLines({ shipId: 'shp_01m3tbfspe96yf1rnr4ank0010', secret: 'aeolus_sk_v1_tester-q8r2', squadronId: 'team-a1b2c3', role: 'tester' }),
        launchNote: 'Start in the root.',
        model: 'claude-opus-5-5',
      },
    });
    expect(commissioned.map(({ name, type }) => ({ name, type }))).toEqual([{ name: 'tester-q8r2', type: 'team-a1b2c3:tester' }]);
  });

  it('keeps the squadron Sailing, with the new member not on station until it checks in', async () => {
    await addMember({ fleetId: FLEET, squadronId: 'team-a1b2c3', role: 'tester' });

    expect(held.state).toBe('sailing');
    expect(held.members.map(({ name, onStationAt, retiredAt }) => ({ name, onStationAt, retiredAt }))).toEqual([
      { name: 'tester-k3x9', onStationAt: FORMED, retiredAt: null },
      { name: 'tester-q8r2', onStationAt: null, retiredAt: null },
    ]);
  });

  it('finishes its formation attempt together with storing the member, so a crash never retires a member it stored', async () => {
    await addMember({ fleetId: FLEET, squadronId: 'team-a1b2c3', role: 'tester' });

    expect(finishedByUpdate).toEqual([attempts.held[0]?.id]);
    expect(attempts.held[0]?.ships).toEqual([{ name: 'tester-q8r2', shipId: 'shp_01m3tbfspe96yf1rnr4ank0010' }]);
  });

  it('names the member after the members of its role so far when the blueprint chooses prefixed names', async () => {
    held = aSquadron('sailing', 'prefixed');

    const added = await addMember({ fleetId: FLEET, squadronId: 'team-a1b2c3', role: 'tester' });

    expect(added.isOk && added.value.name).toBe('team-a1b2c3:tester-2');
  });

  it('forms nothing when the fleet refuses: no member is stored and the attempt is finished', async () => {
    isCommissionRefused = true;

    await expect(addMember({ fleetId: FLEET, squadronId: 'team-a1b2c3', role: 'tester' })).resolves.toMatchObject({ isOk: false, error: { kind: 'ADDING_FAILED' } });

    expect(held.members).toHaveLength(1);
    expect(attempts.held.every((attempt) => attempt.isFinished)).toBe(true);
  });

  it.each<SquadronState>(['forming', 'standing-down', 'disbanded'])('refuses a %s squadron: members are added only while it sails', async (state) => {
    held = aSquadron(state);

    await expect(addMember({ fleetId: FLEET, squadronId: 'team-a1b2c3', role: 'tester' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_SAILING' } });
    expect(commissioned).toEqual([]);
  });

  it('refuses a role its blueprint does not have', async () => {
    await expect(addMember({ fleetId: FLEET, squadronId: 'team-a1b2c3', role: 'reviewer' })).resolves.toMatchObject({ isOk: false, error: { kind: 'ROLE_NOT_FOUND' } });
  });

  it('refuses a squadron the fleet does not have', async () => {
    await expect(addMember({ fleetId: FLEET, squadronId: 'team-zzzzzz', role: 'tester' })).resolves.toMatchObject({ isOk: false, error: { kind: 'SQUADRON_NOT_FOUND' } });
  });

  it('refuses in a fleet squadrons is not connected to, though another fleet is connected', async () => {
    await expect(addMember({ fleetId: OTHER_FLEET, squadronId: 'team-a1b2c3', role: 'tester' })).resolves.toMatchObject({ isOk: false, error: { kind: 'MANAGEMENT_SHIP_NOT_CREWED' } });
  });

  it('refuses while squadrons is not connected', async () => {
    crew = undefined;

    await expect(addMember({ fleetId: FLEET, squadronId: 'team-a1b2c3', role: 'tester' })).resolves.toMatchObject({ isOk: false, error: { kind: 'MANAGEMENT_SHIP_NOT_CREWED' } });
  });
});

describe('a crew request for an added member (#343)', () => {
  /** The squadron whose tester template gives crew settings and a parameter its role fills. */
  function withCrew(): Squadron {
    const squadron = aSquadron('sailing');
    const [role] = squadron.blueprint.roles;
    const [template] = squadron.templates;
    if (!role || !template) {
      return assert.fail('The squadron has a role and a template');
    }
    return {
      ...squadron,
      blueprint: { ...squadron.blueprint, roles: [{ ...role, parameters: { area: 'the API' } }] },
      templates: [{ ...template, crew: { harness: 'claude-code', firstPrompt: 'Test {{area}}.', options: { effort: 'high' } }, parameters: [{ name: 'area', description: 'What it tests' }] }],
    };
  }

  it("writes one from the squadron's own snapshot with the form's settings over it, its first prompt filled and its machine labels as value ids", async () => {
    held = withCrew();

    const added = await addMember({
      fleetId: FLEET,
      squadronId: 'team-a1b2c3',
      role: 'tester',
      member: { crew: { workspace: { kind: 'worktree', repository: 'hemma' }, machineLabels: [{ key: 'os', value: 'macos' }] }, parameters: { area: 'the console' } },
    });

    expect([...requests]).toEqual([
      [
        added.isOk && added.value.shipId,
        {
          harness: 'claude-code',
          workspace: { kind: 'worktree', repository: 'hemma' },
          firstPrompt: 'Test the console.',
          options: { effort: 'high', model: 'claude-opus-5-5' },
          squadron: 'team-a1b2c3',
          machineLabels: ['lbv_01m3tbfspe96yf1rnr4ank9h3a'],
        },
      ],
    ]);
  });

  it("keeps the member's parameter values, its role's with the form's over them, for the flagship to fill its charter", async () => {
    held = withCrew();

    await addMember({ fleetId: FLEET, squadronId: 'team-a1b2c3', role: 'tester', member: { parameters: { area: 'the console' } } });

    expect(held.members.map(({ parameters }) => parameters)).toEqual([{}, { area: 'the console' }]);
  });

  it('writes none for a member whose settings name no workspace: it keeps its crew lines', async () => {
    held = withCrew();

    await addMember({ fleetId: FLEET, squadronId: 'team-a1b2c3', role: 'tester' });

    expect(requests.size).toBe(0);
  });

  it('refuses a machine label the fleet does not define, naming it, and commissions nothing', async () => {
    const added = await addMember({
      fleetId: FLEET,
      squadronId: 'team-a1b2c3',
      role: 'tester',
      member: { crew: { workspace: { kind: 'folder', name: 'notes' }, machineLabels: [{ key: 'os', value: 'windows' }] } },
    });

    expect(added).toEqual({ isOk: false, error: { kind: 'ADDING_FAILED', message: 'The fleet has no machine label os=windows, so no member was added' } });
    expect(commissioned).toEqual([]);
  });

  it('retires the ship and stores no member when the fleet refuses its crew request', async () => {
    isCrewRequestRefused = true;

    const added = await addMember({ fleetId: FLEET, squadronId: 'team-a1b2c3', role: 'tester', member: { crew: { workspace: { kind: 'folder', name: 'notes' } } } });

    expect(added).toMatchObject({ isOk: false, error: { kind: 'ADDING_FAILED' } });
    expect(commissioned.map(({ isRetired }) => isRetired)).toEqual([true]);
    expect(held.members).toHaveLength(1);
  });
});
