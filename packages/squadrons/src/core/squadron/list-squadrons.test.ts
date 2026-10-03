import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import type { FleetDoor, FleetShip, ManagementCrew, ManagementCrewStore } from '../management/ports.js';
import { err, ok } from '../shared/result.js';
import { createListSquadrons } from './list-squadrons.js';
import type { SquadronRepository } from './ports.js';
import type { Squadron } from './squadron.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const MANAGEMENT: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h1a';
const PLANNER: ShipId = 'shp_01m3tbfspe96yf1rnr4ank0001';
const TESTER: ShipId = 'shp_01m3tbfspe96yf1rnr4ank0002';
const FORMED = new Date('2026-10-03T09:00:00.000Z');
const ON_STATION = new Date('2026-10-03T09:05:00.000Z');
const NOW = new Date('2026-10-03T09:50:00.000Z');
const REPO = 'example.com/templates';

function aSquadron(): Squadron {
  return {
    id: 'team-a1b2c3',
    fleetId: FLEET,
    state: 'forming',
    blueprint: {
      repository: REPO,
      name: 'team',
      version: 1,
      file: 'squadrons/fixture.yaml', commit: 'b1',
      committedAt: FORMED,
      description: 'A team.',
      roles: [
        { name: 'planner', template: { repository: REPO, name: 'planner', version: 1 }, count: 1 },
        { name: 'tester', template: { repository: REPO, name: 'tester', version: 4 }, count: 1 },
      ],
      handoffs: [],
      memberNames: 'plain',
    },
    templates: [
      { repository: REPO, name: 'planner', version: 1, file: 'squadrons/fixture.yaml', commit: 'p1', committedAt: FORMED, description: 'Plans.', checkInMinutes: 120, model: null, launchNote: null, charter: 'You plan.', handoffs: [] },
      { repository: REPO, name: 'tester', version: 4, file: 'squadrons/fixture.yaml', commit: 't4', committedAt: FORMED, description: 'Tests.', checkInMinutes: 30, model: null, launchNote: null, charter: 'You test.', handoffs: [] },
    ],
    flagship: { shipId: 'shp_01m3tbfspe96yf1rnr4ank0000', name: 'team-a1b2c3', crewToken: 'aeolus_ct_v1_flagship' },
    members: [
      { shipId: PLANNER, name: 'planner-k3x9', role: 'planner', type: 'team-a1b2c3:planner', onStationAt: null, checkIn: null, standDownMessageId: null, stoodDownAt: null, retiredAt: null },
      { shipId: TESTER, name: 'tester-m4p7', role: 'tester', type: 'team-a1b2c3:tester', onStationAt: ON_STATION, checkIn: { at: ON_STATION, model: null }, standDownMessageId: null, stoodDownAt: null, retiredAt: null },
    ],
    formedAt: FORMED,
    sailedAt: null,
  };
}

let ships: Map<ShipId, FleetShip>;
let crew: ManagementCrew | undefined;
const readAs: string[] = [];

const notUsed = () => Promise.resolve(err({ code: 'FORBIDDEN', message: 'not used' }));
const door: FleetDoor = {
  register: notUsed,
  whoami: notUsed,
  getShip: (crewToken, { shipId }) => {
    readAs.push(crewToken);
    const ship = ships.get(shipId);
    return Promise.resolve(ship ? ok(ship) : err({ code: 'UNAVAILABLE', message: 'The fleet did not answer' }));
  },
  deregister: notUsed,
  commission: notUsed,
  getStartingPrompt: notUsed,
  release: notUsed,
  listShips: notUsed,
  retire: notUsed,
  receive: notUsed,
  ack: notUsed,
  send: notUsed,
};
const management: ManagementCrewStore = {
  find: () => Promise.resolve(crew),
  binding: () => Promise.resolve(crew && { fleetId: crew.fleetId, shipId: crew.shipId }),
  save: () => Promise.resolve(),
  drop: () => Promise.resolve(),
};
const squadrons: SquadronRepository = {
  exists: () => Promise.resolve(true),
  create: () => Promise.resolve(),
  list: (fleetId) => Promise.resolve(fleetId === FLEET ? [aSquadron()] : []),
  update: () => Promise.resolve(),
};

const listSquadrons = createListSquadrons({ door, management, squadrons, clock: { now: () => NOW } });

beforeEach(() => {
  crew = { fleetId: FLEET, shipId: MANAGEMENT, name: 'squadrons', crewToken: 'aeolus_ct_v1_management', crewedAt: FORMED };
  readAs.length = 0;
  ships = new Map<ShipId, FleetShip>([
    [PLANNER, { status: 'awaitingCrew', scopes: [], lastSeenAt: null, crewedSince: null, reportedAt: null, openDeliveries: 0, inFlightDeliveries: 0 }],
    [TESTER, { status: 'crewed', scopes: [], lastSeenAt: new Date('2026-10-03T09:30:00.000Z'), crewedSince: FORMED, reportedAt: null, openDeliveries: 0, inFlightDeliveries: 0 }],
  ]);
});

describe('listing the squadrons', () => {
  it("answers each member's health, crew status, last seen and check-in interval, read from the fleet as the management ship", async () => {
    const listed = await listSquadrons(FLEET);

    expect(listed.isOk && listed.value[0]?.members.map(({ name, health, checkInMinutes, ship }) => ({ name, health, checkInMinutes, ship }))).toEqual([
      { name: 'planner-k3x9', health: 'not-on-station', checkInMinutes: 120, ship: { status: 'awaitingCrew', lastSeenAt: null, crewedSince: null } },
      { name: 'tester-m4p7', health: 'late', checkInMinutes: 30, ship: { status: 'crewed', lastSeenAt: new Date('2026-10-03T09:30:00.000Z'), crewedSince: FORMED } },
    ]);
    expect(new Set(readAs)).toEqual(new Set(['aeolus_ct_v1_management']));
  });

  it('refuses when the fleet does not answer for a member', async () => {
    ships.delete(TESTER);

    await expect(listSquadrons(FLEET)).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
  });

  it('refuses while squadrons is not connected', async () => {
    crew = undefined;

    await expect(listSquadrons(FLEET)).resolves.toMatchObject({ isOk: false, error: { kind: 'MANAGEMENT_SHIP_NOT_CREWED' } });
  });
});
