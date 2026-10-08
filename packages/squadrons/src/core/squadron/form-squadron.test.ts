import { FIRST_PROMPT_MAX_BYTES, idSchema, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { assert, beforeEach, describe, expect, it } from 'vitest';

import { CHARTER_MAX_BYTES, type BlueprintVersion, type Catalogue, type TemplateVersion } from '../catalogue/catalogue.js';
import type { FleetDoor, FleetRefusal, ManagementCrewStore } from '../management/ports.js';
import { err, ok, type Result } from '../shared/result.js';
import { createFormSquadron, type FormSquadron } from './form-squadron.js';
import type { Squadron } from './squadron.js';
import { issuedPrompt, MCP_URL, memberCrewLines } from '../../../test/support/management-fakes.js';
import { memoryAttempts } from '../../../test/support/memory-attempts.js';
import type { SquadronRepository } from './ports.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const MANAGEMENT: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h1a';
const AT = new Date('2026-10-03T09:00:00.000Z');
const REPO = 'example.com/templates';

function templateVersion(name: string, handoffs: string[] = []): TemplateVersion {
  return {
    repository: REPO,
    name,
    version: 1,
    file: 'squadrons/fixture.yaml', commit: `c-${name}`,
    committedAt: AT,
    description: `${name} template`,
    checkInMinutes: 30,
    model: name === 'planner' ? 'claude-opus-5-5' : null,
    launchNote: `Start the ${name} in the repository root.`,
    charter: `You are the ${name}.`,
    handoffs: handoffs.map((handoff) => ({ name: handoff, carries: 'work' })),
    crew: {},
    parameters: [],
  };
}

const blueprintVersion: BlueprintVersion = {
  repository: REPO,
  name: 'hemma-feature',
  version: 4,
  file: 'squadrons/fixture.yaml', commit: 'b-4',
  committedAt: AT,
  description: 'One feature.',
  roles: [
    { name: 'planner', template: { repository: REPO, name: 'planner', version: 1 }, count: 1, model: null, crew: {}, parameters: {} },
    { name: 'implementer', template: { repository: REPO, name: 'implementer', version: 1 }, count: 2, model: null, crew: {}, parameters: {} },
  ],
  handoffs: [{ role: 'implementer', handoff: 'done', to: 'flagship' }],
  memberNames: 'plain',
};

const catalogue: Catalogue = {
  templates: [templateVersion('planner'), templateVersion('implementer', ['done'])],
  blueprints: [blueprintVersion],
  problems: [],
};

/** A fleet that commissions, registers and retires ships, refusing a name an active ship holds. */
interface FleetShip {
  shipId: ShipId;
  name: string;
  type: string;
  secret: string;
  isRetired: boolean;
  isCrewed: boolean;
}

function fakeFleet() {
  const ships: FleetShip[] = [];
  const state = {
    ships,
    refuseCommissionAfter: Number.POSITIVE_INFINITY,
    /** Names whose first commission the fleet carries out, but whose answer never reaches squadrons. */
    answersLost: new Set<string>(),
    keys: new Map<string, ShipId>(),
    /** Each ship's crew request, as squadrons wrote it (#343). */
    requests: new Map<ShipId, unknown>(),
    /** The fleet's label values, by `key=value`. */
    labelValues: new Map<string, string>([['os=macos', 'lbv_01m3tbfspe96yf1rnr4ank9h3a']]),
    refuseCrewRequests: false,
  };
  let next = 0;
  const door: FleetDoor = {
    register: ({ shipId, secret }) => {
      const ship = state.ships.find((held) => held.shipId === shipId && held.secret === secret && !held.isCrewed);
      if (!ship) {
        return Promise.resolve(err({ code: 'UNAUTHORIZED', message: 'Wrong ship id or secret' }));
      }
      ship.isCrewed = true;
      return Promise.resolve(ok({ crewToken: `aeolus_ct_v1_${ship.name}` }));
    },
    whoami: () => Promise.resolve(err({ code: 'UNAUTHORIZED', message: 'not used' })),
    getShip: () => Promise.resolve(err({ code: 'FORBIDDEN', message: 'not used' })),
    deregister: () => Promise.resolve(err({ code: 'FORBIDDEN', message: 'not used' })),
    commission: (crewToken, { name, type, idempotencyKey }): Promise<Result<{ shipId: ShipId; secret: string | null; crewLines: { harness: string; line: string }[] | null }, FleetRefusal>> => {
      if (crewToken !== 'aeolus_ct_v1_management') {
        return Promise.resolve(err({ code: 'UNAUTHORIZED', message: 'Call with the crew token register gave you' }));
      }
      const original = state.keys.get(idempotencyKey);
      if (original) {
        return Promise.resolve(ok({ shipId: original, secret: null, crewLines: null }));
      }
      if (state.ships.filter((ship) => !ship.isRetired).length >= state.refuseCommissionAfter) {
        return Promise.resolve(err({ code: 'INTERNAL_SERVER_ERROR', message: 'Internal error' }));
      }
      if (state.ships.some((ship) => ship.name === name && !ship.isRetired)) {
        return Promise.resolve(err({ code: 'CONFLICT', message: `An active ship is already named ${name}` }));
      }
      next += 1;
      const shipId: ShipId = `shp_01m3tbfspe96yf1rnr4ank${String(next).padStart(4, '0')}`;
      const secret = `aeolus_sk_v1_${name}`;
      state.ships.push({ shipId, name, type, secret, isRetired: false, isCrewed: false });
      state.keys.set(idempotencyKey, shipId);
      if (state.answersLost.delete(name)) {
        return Promise.resolve(err({ code: 'UNAVAILABLE', message: 'The fleet did not answer' }));
      }
      return Promise.resolve(ok({ shipId, ...issuedPrompt(shipId, secret) }));
    },
    release: () => Promise.resolve(err({ code: 'FORBIDDEN', message: 'not used' })),
    requestCrew: (_crewToken, { shipId, settings }) => {
      if (state.refuseCrewRequests) {
        return Promise.resolve(err({ code: 'BAD_REQUEST', message: 'settings is 18211 bytes, the limit is 16384 (decision 0029)' }));
      }
      state.requests.set(shipId, settings);
      return Promise.resolve(ok(undefined));
    },
    removeCrewRequest: () => Promise.resolve(err({ code: 'FORBIDDEN', message: 'not used' })),
    findLabelValue: (_crewToken, { key, value }) => {
      const valueId = state.labelValues.get(`${key}=${value}`);
      return Promise.resolve(valueId === undefined ? err({ code: 'NOT_FOUND', message: `The fleet has no label ${key} with the value ${value}` }) : ok({ valueId: idSchema('labelValue').parse(valueId) }));
    },
    getStartingPrompt: (_crewToken, { shipId }) => {
      const ship = state.ships.find((held) => held.shipId === shipId && !held.isCrewed);
      if (!ship) {
        return Promise.resolve(err({ code: 'CONFLICT', message: 'Only a ship awaiting crew gets a starting prompt' }));
      }
      // A new secret: the one in the lost answer stops working.
      ship.secret = `${ship.secret}-again`;
      return Promise.resolve(ok(issuedPrompt(shipId, ship.secret)));
    },
    receive: () => Promise.resolve(ok([])),
    ack: () => Promise.resolve(ok(undefined)),
    send: () => Promise.resolve(err({ code: 'FORBIDDEN', message: 'not used here' })),
    listShips: () => Promise.resolve(ok(state.ships.filter((ship) => !ship.isRetired).map(({ shipId, name }) => ({ shipId, name })))),
    retire: (_crewToken, { shipId }) => {
      const ship = state.ships.find((held) => held.shipId === shipId);
      if (ship) {
        ship.isRetired = true;
      }
      return Promise.resolve(ok(undefined));
    },
  };
  return { state, door };
}

function memorySquadrons(attempts: ReturnType<typeof memoryAttempts>): SquadronRepository & { held: Squadron[] } {
  const repository: SquadronRepository & { held: Squadron[] } = {
    held: [],
    exists: (fleetId, id) => Promise.resolve(repository.held.some((squadron) => squadron.fleetId === fleetId && squadron.id === id)),
    create: async (squadron, attemptId) => {
      repository.held.push(structuredClone(squadron));
      await attempts.finish(attemptId);
    },
    list: (fleetId) => Promise.resolve(repository.held.filter((squadron) => squadron.fleetId === fleetId)),
    update: () => Promise.resolve(),
  };
  return repository;
}

/** The management ship of each fleet squadrons is connected to: both fleets here. */
const managementStore: ManagementCrewStore = {
  find: (fleetId) => Promise.resolve({ fleetId, shipId: MANAGEMENT, name: 'squadrons', crewToken: 'aeolus_ct_v1_management', crewedAt: AT }),
  binding: (fleetId) => Promise.resolve({ fleetId, shipId: MANAGEMENT }),
  connected: () => Promise.resolve([FLEET, OTHER_FLEET].map((fleetId) => ({ fleetId, shipId: MANAGEMENT, name: 'squadrons', crewToken: 'aeolus_ct_v1_management', crewedAt: AT }))),
  save: () => Promise.resolve(),
  drop: () => Promise.resolve(),
};

let fleet: ReturnType<typeof fakeFleet>;
let attempts: ReturnType<typeof memoryAttempts>;
let squadrons: ReturnType<typeof memorySquadrons>;
/** The longest name suffix, a squadron's. */
const SQUADRON_SUFFIX_LENGTH = 6;
let suffixes: string[];
let form: FormSquadron;

function formWith(overrides: { store?: ManagementCrewStore; catalogue?: Catalogue } = {}): FormSquadron {
  return createFormSquadron({
    door: fleet.door,
    management: overrides.store ?? managementStore,
    squadrons,
    attempts,
    // The catalogue is held per fleet: another fleet's holds nothing here.
    catalogue: (fleetId) => (fleetId === OTHER_FLEET ? { templates: [], blueprints: [], problems: [] } : (overrides.catalogue ?? catalogue)),
    // The names come from the list; an attempt's longer suffix only tells attempts apart.
    random: { suffix: (length) => (length > SQUADRON_SUFFIX_LENGTH ? 'attempt0' : (suffixes.shift() ?? 'zzzzzz').slice(0, length)) },
    clock: { now: () => AT },
    mcpUrl: MCP_URL,
  });
}

beforeEach(() => {
  fleet = fakeFleet();
  attempts = memoryAttempts();
  squadrons = memorySquadrons(attempts);
  suffixes = ['a1b2c3', 'k3x9', 'm4p7', 'q8r2'];
  form = formWith();
});

const fromHemmaFeature = { fleetId: FLEET, blueprint: { repository: REPO, name: 'hemma-feature', version: 4 } };

describe('forming a squadron', () => {
  it('names it after the blueprint with six random characters, and names its flagship the same, of type flagship', async () => {
    const formed = await form(fromHemmaFeature);

    expect(formed).toMatchObject({ isOk: true, value: { squadronId: 'hemma-feature-a1b2c3', flagship: { name: 'hemma-feature-a1b2c3' } } });
    expect(fleet.state.ships[0]).toMatchObject({ name: 'hemma-feature-a1b2c3', type: 'flagship', isCrewed: true });
  });

  it('crews the flagship itself, keeping its crew token, and shows no crew lines for it', async () => {
    unwrapped(await form(fromHemmaFeature));

    expect(squadrons.held[0]?.flagship).toEqual({ shipId: fleet.state.ships[0]?.shipId, name: 'hemma-feature-a1b2c3', crewToken: 'aeolus_ct_v1_hemma-feature-a1b2c3' });
  });

  it('commissions each role count times, named <role>-<four random>, of type <squadron>:<role>', async () => {
    unwrapped(await form(fromHemmaFeature));

    expect(fleet.state.ships.slice(1).map(({ name, type }) => ({ name, type }))).toEqual([
      { name: 'planner-k3x9', type: 'hemma-feature-a1b2c3:planner' },
      { name: 'implementer-m4p7', type: 'hemma-feature-a1b2c3:implementer' },
      { name: 'implementer-q8r2', type: 'hemma-feature-a1b2c3:implementer' },
    ]);
  });

  it("answers each member's crew lines, one per harness, each with the squadron id, and its template's launch note and pinned model, once", async () => {
    const { members } = unwrapped(await form(fromHemmaFeature));

    expect(members[0]).toEqual({
      shipId: fleet.state.ships[1]?.shipId,
      name: 'planner-k3x9',
      role: 'planner',
      crewLines: memberCrewLines({ shipId: idSchema('ship').parse(fleet.state.ships[1]?.shipId), secret: 'aeolus_sk_v1_planner-k3x9', squadronId: 'hemma-feature-a1b2c3', role: 'planner' }),
      launchNote: 'Start the planner in the repository root.',
      model: 'claude-opus-5-5',
    });
  });

  it('stores the squadron forming, with the blueprint and templates it formed from and its members off station, and no member secret', async () => {
    unwrapped(await form(fromHemmaFeature));

    const [stored] = squadrons.held;
    expect(stored).toMatchObject({
      id: 'hemma-feature-a1b2c3',
      fleetId: FLEET,
      state: 'forming',
      blueprint: blueprintVersion,
      templates: catalogue.templates,
      formedAt: AT,
      sailedAt: null,
    });
    expect(stored?.members.map(({ name, role, type, onStationAt, checkIn }) => ({ name, role, type, onStationAt, checkIn }))).toEqual([
      { name: 'planner-k3x9', role: 'planner', type: 'hemma-feature-a1b2c3:planner', onStationAt: null, checkIn: null },
      { name: 'implementer-m4p7', role: 'implementer', type: 'hemma-feature-a1b2c3:implementer', onStationAt: null, checkIn: null },
      { name: 'implementer-q8r2', role: 'implementer', type: 'hemma-feature-a1b2c3:implementer', onStationAt: null, checkIn: null },
    ]);
    expect(JSON.stringify(stored)).not.toContain('aeolus_sk_v1_planner');
  });

  it('takes the squadron id the operator gives', async () => {
    suffixes = ['k3x9', 'm4p7', 'q8r2'];

    await expect(form({ ...fromHemmaFeature, squadronId: 'hemma-login' })).resolves.toMatchObject({ isOk: true, value: { squadronId: 'hemma-login' } });
  });

  it('names members <squadron>:<role>-<n> when the blueprint chooses prefixed names', async () => {
    const prefixed = { ...catalogue, blueprints: [{ ...blueprintVersion, memberNames: 'prefixed' as const }] };

    unwrapped(await formWith({ catalogue: prefixed })(fromHemmaFeature));

    expect(fleet.state.ships.slice(1).map((ship) => ship.name)).toEqual([
      'hemma-feature-a1b2c3:planner-1',
      'hemma-feature-a1b2c3:implementer-1',
      'hemma-feature-a1b2c3:implementer-2',
    ]);
  });

  it('draws another name when a random member name is taken', async () => {
    suffixes = ['a1b2c3', 'k3x9', 'm4p7', 'm4p7', 'q8r2', 'w5t1'];

    unwrapped(await form(fromHemmaFeature));

    expect(fleet.state.ships.slice(1).map((ship) => ship.name)).toEqual(['planner-k3x9', 'implementer-m4p7', 'implementer-q8r2']);
  });
});

describe('the formation attempt', () => {
  it('records each ship before it commissions it, and finishes with the squadron', async () => {
    unwrapped(await form(fromHemmaFeature));

    expect(attempts.held).toEqual([
      expect.objectContaining({
        fleetId: FLEET,
        squadronId: 'hemma-feature-a1b2c3',
        startedAt: AT,
        isFinished: true,
        ships: fleet.state.ships.map(({ name, shipId }) => ({ name, shipId })),
      }),
    ]);
  });

  it('finishes once a failure halfway has retired what it commissioned', async () => {
    fleet.state.refuseCommissionAfter = 3;

    await form(fromHemmaFeature);

    expect(attempts.held.map((attempt) => attempt.isFinished)).toEqual([true]);
  });
});

describe('a squadron not formed', () => {
  it('refuses a blueprint version the catalogue does not hold', async () => {
    await expect(form({ fleetId: FLEET, blueprint: { repository: REPO, name: 'hemma-feature', version: 9 } })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'BLUEPRINT_NOT_FOUND' },
    });
  });

  it("refuses a blueprint only another fleet's catalogue holds: it reads the catalogue of the fleet it forms in", async () => {
    await expect(form({ ...fromHemmaFeature, fleetId: OTHER_FLEET })).resolves.toMatchObject({ isOk: false, error: { kind: 'BLUEPRINT_NOT_FOUND' } });
  });

  it('refuses in a fleet squadrons is not connected to, though another fleet is connected', async () => {
    const onlyOther: ManagementCrewStore = { ...managementStore, find: (fleetId) => (fleetId === OTHER_FLEET ? managementStore.find(fleetId) : Promise.resolve(undefined)) };

    await expect(formWith({ store: onlyOther })(fromHemmaFeature)).resolves.toMatchObject({ isOk: false, error: { kind: 'MANAGEMENT_SHIP_NOT_CREWED' } });
  });

  it('refuses a squadron id that is no handle', async () => {
    await expect(form({ ...fromHemmaFeature, squadronId: 'Hemma Login' })).resolves.toMatchObject({ isOk: false, error: { kind: 'INVALID_SQUADRON_ID' } });
  });

  it('refuses a squadron id another squadron has', async () => {
    unwrapped(await form({ ...fromHemmaFeature, squadronId: 'hemma-login' }));

    await expect(form({ ...fromHemmaFeature, squadronId: 'hemma-login' })).resolves.toMatchObject({ isOk: false, error: { kind: 'SQUADRON_ID_TAKEN' } });
  });

  it("asks again with the same key when the fleet's answer to a commission is lost, and commissions no second ship", async () => {
    fleet.state.answersLost.add('planner-k3x9');

    const formed = unwrapped(await form(fromHemmaFeature));

    expect(fleet.state.ships.filter((ship) => ship.name === 'planner-k3x9')).toHaveLength(1);
    expect(formed.members.map((member) => member.name)).toContain('planner-k3x9');
  });

  it('gives a member whose answer was lost crew lines with a new starting prompt, which claims its ship', async () => {
    fleet.state.answersLost.add('planner-k3x9');

    const [planner] = unwrapped(await form(fromHemmaFeature)).members;
    const [, , shipId = '', secret = ''] = planner?.crewLines[0]?.line.split(' ') ?? [];

    await expect(fleet.door.register({ shipId: idSchema('ship').parse(shipId), secret })).resolves.toMatchObject({ isOk: true });
  });

  it('crews a flagship whose answer was lost with a new starting prompt', async () => {
    fleet.state.answersLost.add('hemma-feature-a1b2c3');

    const formed = unwrapped(await form(fromHemmaFeature));

    expect(fleet.state.ships.filter((ship) => ship.name === formed.squadronId)).toEqual([expect.objectContaining({ isCrewed: true })]);
  });

  it('retires every ship it commissioned and stores nothing when a commission fails halfway', async () => {
    fleet.state.refuseCommissionAfter = 3;

    const formed = await form(fromHemmaFeature);

    expect(formed).toMatchObject({ isOk: false, error: { kind: 'FORMING_FAILED' } });
    expect(formed.isOk ? '' : formed.error.message).toContain('Internal error');
    expect(fleet.state.ships.every((ship) => ship.isRetired)).toBe(true);
    expect(squadrons.held).toEqual([]);
  });

  it('refuses while squadrons crews no management ship', async () => {
    const empty: ManagementCrewStore = { find: () => Promise.resolve(undefined), binding: () => Promise.resolve(undefined), connected: () => Promise.resolve([]), save: () => Promise.resolve(), drop: () => Promise.resolve() };

    await expect(formWith({ store: empty })(fromHemmaFeature)).resolves.toMatchObject({ isOk: false, error: { kind: 'MANAGEMENT_SHIP_NOT_CREWED' } });
  });
});

describe('crew requests at forming (#343)', () => {
  /** The catalogue with crew settings in the implementer template and the blueprint's planner role. */
  function withCrew(): Catalogue {
    const implementer = { ...templateVersion('implementer', ['done']), crew: { harness: 'claude-code', firstPrompt: 'Report to {{lead}}.', options: { effort: 'high' } }, parameters: [{ name: 'lead', description: 'Whom it reports to' }] };
    const roles = blueprintVersion.roles.map((role) =>
      role.name === 'planner'
        ? { ...role, crew: { workspace: { kind: 'worktree' as const, repository: 'hemma' }, machineLabels: [{ key: 'os', value: 'macos' }] } }
        : { ...role, model: 'claude-sonnet-5-5', parameters: { lead: 'the planner' } },
    );
    return { ...catalogue, templates: [templateVersion('planner'), implementer], blueprints: [{ ...blueprintVersion, roles }] };
  }

  it("writes one crew request per member whose merged settings name a workspace: its files' settings, its model as options.model, its machine labels as value ids, and the squadron", async () => {
    const formed = unwrapped(await formWith({ catalogue: withCrew() })(fromHemmaFeature));
    const [planner] = formed.members;

    expect([...fleet.state.requests]).toEqual([
      [
        planner?.shipId,
        { workspace: { kind: 'worktree', repository: 'hemma' }, options: { model: 'claude-opus-5-5' }, squadron: 'hemma-feature-a1b2c3', machineLabels: ['lbv_01m3tbfspe96yf1rnr4ank9h3a'] },
      ],
    ]);
  });

  it('takes each member\'s settings from the form, nearest wins, and fills the parameters of its first prompt', async () => {
    const formed = unwrapped(
      await formWith({ catalogue: withCrew() })({
        ...fromHemmaFeature,
        members: { 'implementer-2': { crew: { workspace: { kind: 'folder', name: 'notes' }, options: { effort: 'max' } }, parameters: { lead: 'planner-k3x9' } } },
      }),
    );

    expect(fleet.state.requests.get(idSchema('ship').parse(formed.members[2]?.shipId))).toEqual({
      harness: 'claude-code',
      workspace: { kind: 'folder', name: 'notes' },
      firstPrompt: 'Report to planner-k3x9.',
      options: { effort: 'max', model: 'claude-sonnet-5-5' },
      squadron: 'hemma-feature-a1b2c3',
    });
    expect(fleet.state.requests.has(idSchema('ship').parse(formed.members[1]?.shipId))).toBe(false);
  });

  it("keeps each member's parameter values, its role's with the form's over them, for the flagship to fill its charter", async () => {
    unwrapped(await formWith({ catalogue: withCrew() })({ ...fromHemmaFeature, members: { 'implementer-2': { parameters: { lead: 'planner-k3x9' } } } }));

    expect(squadrons.held[0]?.members.map(({ role, parameters }) => ({ role, parameters }))).toEqual([
      { role: 'planner', parameters: {} },
      { role: 'implementer', parameters: { lead: 'the planner' } },
      { role: 'implementer', parameters: { lead: 'planner-k3x9' } },
    ]);
  });

  it('refuses a machine label the fleet does not define, naming it, and commissions nothing', async () => {
    fleet.state.labelValues.clear();

    const formed = await formWith({ catalogue: withCrew() })(fromHemmaFeature);

    expect(formed).toEqual({ isOk: false, error: { kind: 'FORMING_FAILED', message: 'The fleet has no machine label os=macos, so nothing was formed' } });
    expect(fleet.state.ships).toEqual([]);
  });

  it('retires every ship it commissioned and stores nothing when the fleet refuses a crew request', async () => {
    fleet.state.refuseCrewRequests = true;

    const formed = await formWith({ catalogue: withCrew() })(fromHemmaFeature);

    expect(formed).toMatchObject({ isOk: false, error: { kind: 'FORMING_FAILED' } });
    expect(fleet.state.ships.every((ship) => ship.isRetired)).toBe(true);
    expect(squadrons.held).toEqual([]);
  });
});

describe("checking the form's members before forming (#371)", () => {
  /** The catalogue whose implementer template uses its `lead` parameter in its charter and first prompt. */
  function withLead(): Catalogue {
    const implementer = { ...templateVersion('implementer', ['done']), charter: 'You report to {{lead}}.', crew: { firstPrompt: 'Report to {{lead}}.' }, parameters: [{ name: 'lead', description: 'Whom it reports to' }] };
    return { ...catalogue, templates: [templateVersion('planner'), implementer] };
  }

  it('refuses a member the blueprint does not have, naming it, and commissions nothing', async () => {
    const formed = await formWith({ catalogue: withLead() })({ ...fromHemmaFeature, members: { 'implementer-3': { parameters: { lead: 'the planner' } } } });

    expect(formed).toEqual({ isOk: false, error: { kind: 'FORMING_FAILED', message: 'The blueprint has no member implementer-3, so nothing was formed' } });
    expect(fleet.state.ships).toEqual([]);
  });

  it('refuses a member whose charter is over 48 KB once filled, naming it, and commissions nothing', async () => {
    const lead = 'x'.repeat(CHARTER_MAX_BYTES);

    const formed = await formWith({ catalogue: withLead() })({ ...fromHemmaFeature, members: { 'implementer-2': { parameters: { lead } } } });

    expect(formed).toEqual({ isOk: false, error: { kind: 'FORMING_FAILED', message: 'The charter of implementer-2 is over 48 KB once filled, so nothing was formed' } });
    expect(fleet.state.ships).toEqual([]);
  });

  it('refuses a member whose first prompt is over 8 KB once filled, naming it, and commissions nothing', async () => {
    const lead = 'x'.repeat(FIRST_PROMPT_MAX_BYTES);

    const formed = await formWith({ catalogue: withLead() })({ ...fromHemmaFeature, members: { 'implementer-1': { parameters: { lead } } } });

    expect(formed).toEqual({ isOk: false, error: { kind: 'FORMING_FAILED', message: 'The first prompt of implementer-1 is over 8 KB once filled, so nothing was formed' } });
    expect(fleet.state.ships).toEqual([]);
  });

  it('forms a member whose charter is exactly 48 KB once filled', async () => {
    const lead = 'x'.repeat(CHARTER_MAX_BYTES - 'You report to .'.length);
    const catalogueWithoutPrompt = withLead();

    const formed = await formWith({ catalogue: { ...catalogueWithoutPrompt, templates: catalogueWithoutPrompt.templates.map((template) => ({ ...template, crew: {} })) } })({
      ...fromHemmaFeature,
      members: { 'implementer-1': { parameters: { lead } } },
    });

    expect(formed.isOk).toBe(true);
  });
});

function unwrapped<T>(result: Result<T, unknown>): T {
  if (!result.isOk) {
    assert.fail(`Expected ok, got ${JSON.stringify(result.error)}`);
  }
  return result.value;
}
