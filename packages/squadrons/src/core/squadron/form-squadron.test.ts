import { idSchema, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { assert, beforeEach, describe, expect, it } from 'vitest';

import type { BlueprintVersion, Catalogue, TemplateVersion } from '../catalogue/catalogue.js';
import type { FleetDoor, FleetRefusal, ManagementCrewStore } from '../management/ports.js';
import { err, ok, type Result } from '../shared/result.js';
import { createFormSquadron, type FormSquadron } from './form-squadron.js';
import type { Squadron } from './squadron.js';
import { memoryAttempts } from '../../../test/support/memory-attempts.js';
import type { SquadronRepository } from './ports.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
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
    { name: 'planner', template: { repository: REPO, name: 'planner', version: 1 }, count: 1 },
    { name: 'implementer', template: { repository: REPO, name: 'implementer', version: 1 }, count: 2 },
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
    commission: (crewToken, { name, type, idempotencyKey }): Promise<Result<{ shipId: ShipId; crewLine: string | null }, FleetRefusal>> => {
      if (crewToken !== 'aeolus_ct_v1_management') {
        return Promise.resolve(err({ code: 'UNAUTHORIZED', message: 'Call with the crew token register gave you' }));
      }
      const original = state.keys.get(idempotencyKey);
      if (original) {
        return Promise.resolve(ok({ shipId: original, crewLine: null }));
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
      return Promise.resolve(ok({ shipId, crewLine: `/aeolus:crew https://fleet.example.com ${shipId} ${secret}` }));
    },
    release: () => Promise.resolve(err({ code: 'FORBIDDEN', message: 'not used' })),
    getStartingPrompt: (_crewToken, { shipId }) => {
      const ship = state.ships.find((held) => held.shipId === shipId && !held.isCrewed);
      if (!ship) {
        return Promise.resolve(err({ code: 'CONFLICT', message: 'Only a ship awaiting crew gets a starting prompt' }));
      }
      // A new secret: the one in the lost answer stops working.
      ship.secret = `${ship.secret}-again`;
      return Promise.resolve(ok({ crewLine: `/aeolus:crew https://fleet.example.com ${shipId} ${ship.secret}` }));
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

const managementStore: ManagementCrewStore = {
  find: () => Promise.resolve({ fleetId: FLEET, shipId: MANAGEMENT, name: 'squadrons', crewToken: 'aeolus_ct_v1_management', crewedAt: AT }),
  binding: () => Promise.resolve({ fleetId: FLEET, shipId: MANAGEMENT }),
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
    catalogue: () => overrides.catalogue ?? catalogue,
    // The names come from the list; an attempt's longer suffix only tells attempts apart.
    random: { suffix: (length) => (length > SQUADRON_SUFFIX_LENGTH ? 'attempt0' : (suffixes.shift() ?? 'zzzzzz').slice(0, length)) },
    clock: { now: () => AT },
  });
}

beforeEach(() => {
  fleet = fakeFleet();
  attempts = memoryAttempts();
  squadrons = memorySquadrons(attempts);
  suffixes = ['a1b2c3', 'k3x9', 'm4p7', 'q8r2'];
  form = formWith();
});

const fromHemmaFeature = { blueprint: { repository: REPO, name: 'hemma-feature', version: 4 } };

describe('forming a squadron', () => {
  it('names it after the blueprint with six random characters, and names its flagship the same, of type flagship', async () => {
    const formed = await form(fromHemmaFeature);

    expect(formed).toMatchObject({ isOk: true, value: { squadronId: 'hemma-feature-a1b2c3', flagship: { name: 'hemma-feature-a1b2c3' } } });
    expect(fleet.state.ships[0]).toMatchObject({ name: 'hemma-feature-a1b2c3', type: 'flagship', isCrewed: true });
  });

  it('crews the flagship itself, keeping its crew token, and shows no crew line for it', async () => {
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

  it("answers each member's crew line with the squadron id, and its template's launch note and pinned model, once", async () => {
    const { members } = unwrapped(await form(fromHemmaFeature));

    expect(members[0]).toEqual({
      shipId: fleet.state.ships[1]?.shipId,
      name: 'planner-k3x9',
      role: 'planner',
      crewLine: `/aeolus:crew https://fleet.example.com ${String(fleet.state.ships[1]?.shipId)} aeolus_sk_v1_planner-k3x9 hemma-feature-a1b2c3`,
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
    await expect(form({ blueprint: { repository: REPO, name: 'hemma-feature', version: 9 } })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'BLUEPRINT_NOT_FOUND' },
    });
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

  it('gives a member whose answer was lost a crew line with a new starting prompt, which claims its ship', async () => {
    fleet.state.answersLost.add('planner-k3x9');

    const [planner] = unwrapped(await form(fromHemmaFeature)).members;
    const [, , shipId = '', secret = ''] = planner?.crewLine.split(' ') ?? [];

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
    const empty: ManagementCrewStore = { find: () => Promise.resolve(undefined), binding: () => Promise.resolve(undefined), save: () => Promise.resolve(), drop: () => Promise.resolve() };

    await expect(formWith({ store: empty })(fromHemmaFeature)).resolves.toMatchObject({ isOk: false, error: { kind: 'MANAGEMENT_SHIP_NOT_CREWED' } });
  });
});

function unwrapped<T>(result: Result<T, unknown>): T {
  if (!result.isOk) {
    assert.fail(`Expected ok, got ${JSON.stringify(result.error)}`);
  }
  return result.value;
}
