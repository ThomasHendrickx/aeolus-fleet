import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import type { FleetDoor, FleetShip, ManagementCrew, ManagementCrewStore } from '../management/ports.js';
import { err, ok } from '../shared/result.js';
import { createForceStandDown } from './force-stand-down.js';
import type { SquadronRepository } from './ports.js';
import type { Member, Squadron, SquadronState } from './squadron.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const MANAGEMENT: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h1a';
const FLAGSHIP: ShipId = 'shp_01m3tbfspe96yf1rnr4ank0000';
const PLANNER: ShipId = 'shp_01m3tbfspe96yf1rnr4ank0001';
const TESTER: ShipId = 'shp_01m3tbfspe96yf1rnr4ank0002';
const FORMED = new Date('2026-10-03T09:00:00.000Z');
const NOW = new Date('2026-10-03T10:00:00.000Z');
const REPO = 'example.com/templates';

function aMember(shipId: ShipId, role: string): Member {
  return { shipId, name: `${role}-k3x9`, role, type: `team-a1b2c3:${role}`, onStationAt: null, checkIn: null, standDownMessageId: null, stoodDownAt: null, retiredAt: null };
}

function aSquadron(state: SquadronState): Squadron {
  return {
    id: 'team-a1b2c3',
    fleetId: FLEET,
    state,
    blueprint: { repository: REPO, name: 'team', version: 1, file: 'squadrons/fixture.yaml', commit: 'b1', committedAt: FORMED, description: 'A team.', roles: [], handoffs: [], memberNames: 'plain' },
    templates: [],
    flagship: { shipId: FLAGSHIP, name: 'team-a1b2c3', crewToken: 'aeolus_ct_v1_flagship' },
    members: [aMember(PLANNER, 'planner'), aMember(TESTER, 'tester')],
    formedAt: FORMED,
    sailedAt: null,
  };
}

function aShip(): FleetShip {
  return { status: 'crewed', scopes: [], lastSeenAt: null, crewedSince: FORMED, reportedAt: null, openDeliveries: 1, inFlightDeliveries: 1 };
}

let held: Squadron;
let ships: Map<ShipId, FleetShip>;
const retired: ShipId[] = [];
/** The ship whose retire the fleet does not answer, if any. */
let failingShip: ShipId | undefined;

const notUsed = () => Promise.resolve(err({ code: 'FORBIDDEN', message: 'not used' }));
const door: FleetDoor = {
  register: notUsed,
  whoami: notUsed,
  deregister: notUsed,
  commission: notUsed,
  getStartingPrompt: notUsed,
  release: notUsed,
  listShips: notUsed,
  receive: notUsed,
  ack: notUsed,
  send: notUsed,
  getShip: (crewToken, { shipId }) => {
    const ship = ships.get(shipId);
    return Promise.resolve(crewToken === 'aeolus_ct_v1_management' && ship ? ok(ship) : err({ code: 'NOT_FOUND', message: 'No such ship' }));
  },
  retire: (crewToken, { shipId }) => {
    const ship = ships.get(shipId);
    if (shipId === failingShip) {
      return Promise.resolve(err({ code: 'UNAVAILABLE', message: 'The fleet did not answer' }));
    }
    if (crewToken !== 'aeolus_ct_v1_management' || !ship) {
      return notUsed();
    }
    if (ship.status === 'retired') {
      return Promise.resolve(err({ code: 'CONFLICT', message: 'retired already' }));
    }
    ships.set(shipId, { ...ship, status: 'retired' });
    retired.push(shipId);
    return Promise.resolve(ok(undefined));
  },
};

let crew: ManagementCrew | undefined;
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
  update: ({ after }) => {
    held = structuredClone(after);
    return Promise.resolve();
  },
};

const forceStandDown = createForceStandDown({ door, management, squadrons, clock: { now: () => NOW } });

beforeEach(() => {
  held = aSquadron('sailing');
  crew = { fleetId: FLEET, shipId: MANAGEMENT, name: 'squadrons', crewToken: 'aeolus_ct_v1_management', crewedAt: FORMED };
  ships = new Map([
    [FLAGSHIP, aShip()],
    [PLANNER, aShip()],
    [TESTER, aShip()],
  ]);
  retired.length = 0;
  failingShip = undefined;
});

describe('forcing a stand down', () => {
  it.each<SquadronState>(['forming', 'sailing', 'standing-down'])(
    'retires every member of a %s squadron at once, open deliveries and all, then the flagship: the squadron is disbanded',
    async (state) => {
      held = aSquadron(state);

      await expect(forceStandDown({ fleetId: FLEET, squadronId: 'team-a1b2c3' })).resolves.toEqual({ isOk: true, value: undefined });

      expect(retired).toEqual([PLANNER, TESTER, FLAGSHIP]);
      expect(held.members.map((member) => member.retiredAt)).toEqual([NOW, NOW]);
      expect(held.state).toBe('disbanded');
    },
  );

  it('leaves a member retired already as it is, and counts a ship retired already as retired', async () => {
    held = { ...held, members: [{ ...aMember(PLANNER, 'planner'), retiredAt: FORMED }, aMember(TESTER, 'tester')] };
    ships.set(TESTER, { ...aShip(), status: 'retired' });

    await forceStandDown({ fleetId: FLEET, squadronId: 'team-a1b2c3' });

    expect(held.members.map((member) => member.retiredAt)).toEqual([FORMED, NOW]);
    expect(held.state).toBe('disbanded');
  });

  it('keeps what it retired when the fleet does not answer for one ship, and forcing again finishes', async () => {
    failingShip = TESTER;

    await expect(forceStandDown({ fleetId: FLEET, squadronId: 'team-a1b2c3' })).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
    expect(held.members.map((member) => member.retiredAt)).toEqual([NOW, null]);
    expect(held.state).toBe('sailing');

    failingShip = undefined;
    await forceStandDown({ fleetId: FLEET, squadronId: 'team-a1b2c3' });

    expect(held.state).toBe('disbanded');
    expect(retired).toEqual([PLANNER, TESTER, FLAGSHIP]);
  });

  it('refuses a squadron that is disbanded already', async () => {
    held = aSquadron('disbanded');

    await expect(forceStandDown({ fleetId: FLEET, squadronId: 'team-a1b2c3' })).resolves.toMatchObject({ isOk: false, error: { kind: 'ALREADY_DISBANDED' } });
    expect(retired).toEqual([]);
  });

  it('refuses a squadron the fleet does not have', async () => {
    await expect(forceStandDown({ fleetId: FLEET, squadronId: 'team-zzzzzz' })).resolves.toMatchObject({ isOk: false, error: { kind: 'SQUADRON_NOT_FOUND' } });
  });

  it('refuses in a fleet squadrons is not connected to, though another fleet is connected', async () => {
    await expect(forceStandDown({ fleetId: OTHER_FLEET, squadronId: 'team-a1b2c3' })).resolves.toMatchObject({ isOk: false, error: { kind: 'MANAGEMENT_SHIP_NOT_CREWED' } });
  });

  it('refuses while squadrons is not connected', async () => {
    crew = undefined;

    await expect(forceStandDown({ fleetId: FLEET, squadronId: 'team-a1b2c3' })).resolves.toMatchObject({ isOk: false, error: { kind: 'MANAGEMENT_SHIP_NOT_CREWED' } });
  });
});
