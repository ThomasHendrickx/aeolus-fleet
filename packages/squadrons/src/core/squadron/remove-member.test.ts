import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import type { FleetDoor, FleetShip, ManagementCrew, ManagementCrewStore } from '../management/ports.js';
import { err, ok } from '../shared/result.js';
import { createRemoveMember } from './remove-member.js';
import type { SquadronRepository } from './ports.js';
import type { Member, Squadron, SquadronState } from './squadron.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const MANAGEMENT: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h1a';
const PLANNER: ShipId = 'shp_01m3tbfspe96yf1rnr4ank0001';
const TESTER: ShipId = 'shp_01m3tbfspe96yf1rnr4ank0002';
const STRANGER: ShipId = 'shp_01m3tbfspe96yf1rnr4ank0009';
const FORMED = new Date('2026-10-03T09:00:00.000Z');
const NOW = new Date('2026-10-03T10:00:00.000Z');
const REPO = 'example.com/templates';

function aMember(shipId: ShipId, role: string): Member {
  return { shipId, name: `${role}-k3x9`, role, type: `team-a1b2c3:${role}`, onStationAt: FORMED, checkIn: null, standDownMessageId: null, stoodDownAt: null, retiredAt: null, releasingSince: null, parameters: {} };
}

function aSquadron(state: SquadronState): Squadron {
  return {
    id: 'team-a1b2c3',
    fleetId: FLEET,
    state,
    blueprint: { repository: REPO, name: 'team', version: 1, file: 'squadrons/fixture.yaml', commit: 'b1', committedAt: FORMED, description: 'A team.', roles: [], handoffs: [], memberNames: 'plain' },
    templates: [],
    flagship: { shipId: 'shp_01m3tbfspe96yf1rnr4ank0000', name: 'team-a1b2c3', crewToken: 'aeolus_ct_v1_flagship' },
    members: [aMember(PLANNER, 'planner'), aMember(TESTER, 'tester')],
    formedAt: FORMED,
    sailedAt: FORMED,
  };
}

let held: Squadron;
let ships: Map<ShipId, FleetShip>;
const retired: ShipId[] = [];
/** Each ship whose crew request squadrons removed: the fleet keeps it while its crew is released. */
const requestsRemoved: ShipId[] = [];
let isFleetDown: boolean;

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
  getShip: (_crewToken, { shipId }) => {
    const ship = ships.get(shipId);
    return Promise.resolve(ship ? ok(ship) : err({ code: 'NOT_FOUND', message: 'No such ship' }));
  },
  requestCrew: notUsed,
  removeCrewRequest: (crewToken, { shipId }) => {
    if (isFleetDown) {
      return Promise.resolve(err({ code: 'UNAVAILABLE', message: 'The fleet did not answer' }));
    }
    if (crewToken !== 'aeolus_ct_v1_management' || ships.get(shipId)?.hasCrewRequest !== true) {
      return Promise.resolve(err({ code: 'NOT_FOUND', message: 'The ship holds no crew request' }));
    }
    requestsRemoved.push(shipId);
    return Promise.resolve(ok(undefined));
  },
  findLabelValue: notUsed,
  retire: (crewToken, { shipId }) => {
    const ship = ships.get(shipId);
    if (isFleetDown) {
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

const removeMember = createRemoveMember({ door, management, squadrons, clock: { now: () => NOW } });

beforeEach(() => {
  held = aSquadron('sailing');
  crew = { fleetId: FLEET, shipId: MANAGEMENT, name: 'squadrons', crewToken: 'aeolus_ct_v1_management', crewedAt: FORMED };
  const crewed: FleetShip = { status: 'crewed', scopes: [], lastSeenAt: null, crewedSince: FORMED, reportedAt: null, openDeliveries: 2, inFlightDeliveries: 1, hasCrewRequest: false };
  ships = new Map([
    [PLANNER, crewed],
    [TESTER, crewed],
  ]);
  retired.length = 0;
  requestsRemoved.length = 0;
  isFleetDown = false;
});

describe('removing a member', () => {
  it.each<SquadronState>(['sailing', 'standing-down'])('retires the member of a %s squadron at once, its open deliveries and all', async (state) => {
    held = aSquadron(state);

    await expect(removeMember({ fleetId: FLEET, squadronId: 'team-a1b2c3', shipId: TESTER })).resolves.toEqual({ isOk: true, value: undefined });

    expect(retired).toEqual([TESTER]);
    expect(held.members.map((member) => member.retiredAt)).toEqual([null, NOW]);
    expect(held.state).toBe(state);
  });

  it('removes the crew request of a member that has one and shows it releasing: it is retired once its crew is released (#343)', async () => {
    ships.set(TESTER, { status: 'crewed', scopes: [], lastSeenAt: null, crewedSince: FORMED, reportedAt: null, openDeliveries: 0, inFlightDeliveries: 0, hasCrewRequest: true });

    await expect(removeMember({ fleetId: FLEET, squadronId: 'team-a1b2c3', shipId: TESTER })).resolves.toEqual({ isOk: true, value: undefined });

    expect(requestsRemoved).toEqual([TESTER]);
    expect(retired).toEqual([]);
    expect(held.members.map(({ releasingSince, retiredAt }) => ({ releasingSince, retiredAt }))).toEqual([
      { releasingSince: null, retiredAt: null },
      { releasingSince: NOW, retiredAt: null },
    ]);
  });

  it('removes the last member of a role: no rule keeps one', async () => {
    held = { ...held, members: [aMember(TESTER, 'tester')] };

    await expect(removeMember({ fleetId: FLEET, squadronId: 'team-a1b2c3', shipId: TESTER })).resolves.toMatchObject({ isOk: true });
  });

  it('counts a member whose ship is retired already as removed', async () => {
    ships.set(TESTER, { status: 'retired', scopes: [], lastSeenAt: null, crewedSince: null, reportedAt: null, openDeliveries: 0, inFlightDeliveries: 0, hasCrewRequest: false });

    await expect(removeMember({ fleetId: FLEET, squadronId: 'team-a1b2c3', shipId: TESTER })).resolves.toMatchObject({ isOk: true });
    expect(held.members.find((member) => member.shipId === TESTER)?.retiredAt).toEqual(NOW);
  });

  it('keeps the member as it is when the fleet does not answer', async () => {
    isFleetDown = true;

    await expect(removeMember({ fleetId: FLEET, squadronId: 'team-a1b2c3', shipId: TESTER })).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
    expect(held.members.every((member) => member.retiredAt === null)).toBe(true);
  });

  it.each<SquadronState>(['forming', 'disbanded'])('refuses a %s squadron: members are removed while it sails or stands down', async (state) => {
    held = aSquadron(state);

    await expect(removeMember({ fleetId: FLEET, squadronId: 'team-a1b2c3', shipId: TESTER })).resolves.toMatchObject({ isOk: false, error: { kind: 'SQUADRON_NOT_SERVING' } });
    expect(retired).toEqual([]);
  });

  it('refuses a ship that is no member of the squadron', async () => {
    await expect(removeMember({ fleetId: FLEET, squadronId: 'team-a1b2c3', shipId: STRANGER })).resolves.toMatchObject({ isOk: false, error: { kind: 'MEMBER_NOT_FOUND' } });
  });

  it('refuses a squadron the fleet does not have', async () => {
    await expect(removeMember({ fleetId: FLEET, squadronId: 'team-zzzzzz', shipId: TESTER })).resolves.toMatchObject({ isOk: false, error: { kind: 'SQUADRON_NOT_FOUND' } });
  });

  it('refuses in a fleet squadrons is not connected to, though another fleet is connected', async () => {
    await expect(removeMember({ fleetId: OTHER_FLEET, squadronId: 'team-a1b2c3', shipId: TESTER })).resolves.toMatchObject({ isOk: false, error: { kind: 'MANAGEMENT_SHIP_NOT_CREWED' } });
  });

  it('refuses while squadrons is not connected', async () => {
    crew = undefined;

    await expect(removeMember({ fleetId: FLEET, squadronId: 'team-a1b2c3', shipId: TESTER })).resolves.toMatchObject({ isOk: false, error: { kind: 'MANAGEMENT_SHIP_NOT_CREWED' } });
  });
});
