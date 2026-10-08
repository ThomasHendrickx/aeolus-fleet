import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import type { FleetDoor, FleetShip, ManagementCrew, ManagementCrewStore } from '../management/ports.js';
import { err, ok } from '../shared/result.js';
import { createNewCrewLine } from './new-crew-line.js';
import type { SquadronRepository } from './ports.js';
import type { Member, Squadron } from './squadron.js';
import { issuedPrompt, MCP_URL, memberCrewLines } from '../../../test/support/management-fakes.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const MANAGEMENT: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h1a';
const TESTER: ShipId = 'shp_01m3tbfspe96yf1rnr4ank0002';
const STRANGER: ShipId = 'shp_01m3tbfspe96yf1rnr4ank0009';
const FORMED = new Date('2026-10-03T09:00:00.000Z');
const REPO = 'example.com/templates';

function aTester(retiredAt: Date | null = null): Member {
  return { shipId: TESTER, name: 'tester-k3x9', role: 'tester', type: 'team-a1b2c3:tester', onStationAt: FORMED, checkIn: null, standDownMessageId: null, stoodDownAt: null, retiredAt, releasingSince: null };
}

function aSquadron(member: Member = aTester()): Squadron {
  return {
    id: 'team-a1b2c3',
    fleetId: FLEET,
    state: 'sailing',
    blueprint: {
      repository: REPO,
      name: 'team',
      version: 1,
      file: 'squadrons/fixture.yaml', commit: 'b1',
      committedAt: FORMED,
      description: 'A team.',
      roles: [{ name: 'tester', template: { repository: REPO, name: 'tester', version: 4 }, count: 1, model: null, crew: {}, parameters: {} }],
      handoffs: [],
      memberNames: 'plain',
    },
    templates: [
      { repository: REPO, name: 'tester', version: 4, file: 'squadrons/fixture.yaml', commit: 't4', committedAt: FORMED, description: 'Tests.', checkInMinutes: 30, model: 'claude-opus-5-5', launchNote: 'Start in the root.', charter: 'You test.', handoffs: [], crew: {}, parameters: [] },
    ],
    flagship: { shipId: 'shp_01m3tbfspe96yf1rnr4ank0000', name: 'team-a1b2c3', crewToken: 'aeolus_ct_v1_flagship' },
    members: [member],
    formedAt: FORMED,
    sailedAt: FORMED,
  };
}

let held: Squadron;
let ship: FleetShip;
const calls: string[] = [];

const notUsed = () => Promise.resolve(err({ code: 'FORBIDDEN', message: 'not used' }));
const door: FleetDoor = {
  register: notUsed,
  whoami: notUsed,
  deregister: notUsed,
  commission: notUsed,
  listShips: notUsed,
  receive: notUsed,
  ack: notUsed,
  send: notUsed,
  requestCrew: notUsed,
  removeCrewRequest: notUsed,
  findLabelValue: notUsed,
  retire: notUsed,
  getShip: (_crewToken, { shipId }) => Promise.resolve(shipId === TESTER ? ok(ship) : err({ code: 'NOT_FOUND', message: 'No such ship' })),
  release: (crewToken, { shipId }) => {
    calls.push(`release ${shipId}`);
    if (crewToken !== 'aeolus_ct_v1_management') {
      return notUsed();
    }
    ship = { ...ship, status: 'awaitingCrew', crewedSince: null };
    return Promise.resolve(ok(undefined));
  },
  getStartingPrompt: (crewToken, { shipId }) => {
    calls.push(`prompt ${shipId}`);
    if (crewToken !== 'aeolus_ct_v1_management' || ship.status !== 'awaitingCrew') {
      return Promise.resolve(err({ code: 'CONFLICT', message: 'Only a ship awaiting crew gets a starting prompt' }));
    }
    return Promise.resolve(ok(issuedPrompt(shipId, 'aeolus_sk_v1_new')));
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
  update: () => Promise.resolve(),
};

const newCrewLine = createNewCrewLine({ door, management, squadrons, mcpUrl: MCP_URL });

beforeEach(() => {
  held = aSquadron();
  crew = { fleetId: FLEET, shipId: MANAGEMENT, name: 'squadrons', crewToken: 'aeolus_ct_v1_management', crewedAt: FORMED };
  ship = { status: 'crewed', scopes: [], lastSeenAt: null, crewedSince: FORMED, reportedAt: null, openDeliveries: 0, inFlightDeliveries: 0, hasCrewRequest: false };
  calls.length = 0;
});

describe("a member's new crew line", () => {
  it('releases the crewed ship, then answers new crew lines, one per harness, each with the squadron id, its launch note and pinned model, once', async () => {
    await expect(newCrewLine({ fleetId: FLEET, squadronId: 'team-a1b2c3', shipId: TESTER })).resolves.toEqual({
      isOk: true,
      value: { crewLines: memberCrewLines({ shipId: TESTER, secret: 'aeolus_sk_v1_new', squadronId: 'team-a1b2c3', role: 'tester' }), launchNote: 'Start in the root.', model: 'claude-opus-5-5' },
    });
    expect(calls).toEqual([`release ${TESTER}`, `prompt ${TESTER}`]);
  });

  it('releases nothing when no session crews the ship', async () => {
    ship = { ...ship, status: 'awaitingCrew', crewedSince: null };

    await newCrewLine({ fleetId: FLEET, squadronId: 'team-a1b2c3', shipId: TESTER });

    expect(calls).toEqual([`prompt ${TESTER}`]);
  });

  it('refuses a member squadrons retired', async () => {
    held = aSquadron(aTester(FORMED));

    await expect(newCrewLine({ fleetId: FLEET, squadronId: 'team-a1b2c3', shipId: TESTER })).resolves.toMatchObject({ isOk: false, error: { kind: 'MEMBER_RETIRED' } });
    expect(calls).toEqual([]);
  });

  it('refuses a ship that is no member of the squadron', async () => {
    await expect(newCrewLine({ fleetId: FLEET, squadronId: 'team-a1b2c3', shipId: STRANGER })).resolves.toMatchObject({ isOk: false, error: { kind: 'MEMBER_NOT_FOUND' } });
  });

  it('refuses a squadron the fleet does not have', async () => {
    await expect(newCrewLine({ fleetId: FLEET, squadronId: 'team-zzzzzz', shipId: TESTER })).resolves.toMatchObject({ isOk: false, error: { kind: 'SQUADRON_NOT_FOUND' } });
  });

  it('refuses in a fleet squadrons is not connected to, though another fleet is connected', async () => {
    await expect(newCrewLine({ fleetId: OTHER_FLEET, squadronId: 'team-a1b2c3', shipId: TESTER })).resolves.toMatchObject({ isOk: false, error: { kind: 'MANAGEMENT_SHIP_NOT_CREWED' } });
  });

  it('refuses when the fleet refuses a step', async () => {
    ship = { ...ship, status: 'retired' };

    await expect(newCrewLine({ fleetId: FLEET, squadronId: 'team-a1b2c3', shipId: TESTER })).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
  });

  it('refuses while squadrons is not connected', async () => {
    crew = undefined;

    await expect(newCrewLine({ fleetId: FLEET, squadronId: 'team-a1b2c3', shipId: TESTER })).resolves.toMatchObject({ isOk: false, error: { kind: 'MANAGEMENT_SHIP_NOT_CREWED' } });
  });
});
