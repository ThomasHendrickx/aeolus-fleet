import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import type { FleetDoor, ManagementCrewStore } from '../management/ports.js';
import { err, ok } from '../shared/result.js';
import { memoryAttempts } from '../../../test/support/memory-attempts.js';
import { createRecoverFormations } from './recover-formations.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const MANAGEMENT: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h1a';
const AT = new Date('2026-10-03T09:00:00.000Z');

let ships: { shipId: ShipId; name: string; isRetired: boolean }[];
let attempts: ReturnType<typeof memoryAttempts>;

const door: FleetDoor = {
  register: () => Promise.resolve(err({ code: 'FORBIDDEN', message: 'not used' })),
  whoami: () => Promise.resolve(err({ code: 'FORBIDDEN', message: 'not used' })),
  commission: () => Promise.resolve(err({ code: 'FORBIDDEN', message: 'not used' })),
  receive: () => Promise.resolve(ok([])),
  ack: () => Promise.resolve(ok(undefined)),
  send: () => Promise.resolve(err({ code: 'FORBIDDEN', message: 'not used' })),
  listShips: () => Promise.resolve(ok(ships.filter((ship) => !ship.isRetired).map(({ shipId, name }) => ({ shipId, name })))),
  retire: (_crewToken, { shipId }) => {
    const ship = ships.find((held) => held.shipId === shipId);
    if (!ship || ship.isRetired) {
      return Promise.resolve(err({ code: 'CONFLICT', message: 'retired already' }));
    }
    ship.isRetired = true;
    return Promise.resolve(ok(undefined));
  },
};

const management: ManagementCrewStore = {
  find: () => Promise.resolve({ fleetId: FLEET, shipId: MANAGEMENT, crewToken: 'aeolus_ct_v1_management', crewedAt: AT }),
  save: () => Promise.resolve(),
};

beforeEach(async () => {
  ships = [
    { shipId: 'shp_01m3tbfspe96yf1rnr4ank0001', name: 'team-a1b2c3', isRetired: false },
    { shipId: 'shp_01m3tbfspe96yf1rnr4ank0002', name: 'planner-k3x9', isRetired: false },
    { shipId: 'shp_01m3tbfspe96yf1rnr4ank0003', name: 'tester-m4p7', isRetired: false },
    { shipId: 'shp_01m3tbfspe96yf1rnr4ank0009', name: 'unrelated', isRetired: false },
  ];
  attempts = memoryAttempts();
  // A forming that died midway: the flagship and the planner recorded with their ids, the
  // tester commissioned but killed before its id was recorded, the last member never commissioned.
  await attempts.begin({ id: 'attempt-1', fleetId: FLEET, squadronId: 'team-a1b2c3', startedAt: AT });
  for (const name of ['team-a1b2c3', 'planner-k3x9', 'tester-m4p7', 'tester-q8r2']) {
    await attempts.plan('attempt-1', name);
  }
  await attempts.commissioned('attempt-1', { name: 'team-a1b2c3', shipId: 'shp_01m3tbfspe96yf1rnr4ank0001' });
  await attempts.commissioned('attempt-1', { name: 'planner-k3x9', shipId: 'shp_01m3tbfspe96yf1rnr4ank0002' });
});

const recover = () => createRecoverFormations({ door, management, attempts })();

describe('recovering formations a crash left unfinished', () => {
  it('retires every ship the attempt commissioned, finding by name one whose id was never recorded', async () => {
    await expect(recover()).resolves.toEqual({ isOk: true, value: { recovered: 1, retired: 3 } });

    expect(ships.map(({ name, isRetired }) => ({ name, isRetired }))).toEqual([
      { name: 'team-a1b2c3', isRetired: true },
      { name: 'planner-k3x9', isRetired: true },
      { name: 'tester-m4p7', isRetired: true },
      { name: 'unrelated', isRetired: false },
    ]);
  });

  it('finishes the attempt, so a second start finds nothing left to do', async () => {
    await recover();

    await expect(recover()).resolves.toEqual({ isOk: true, value: { recovered: 0, retired: 0 } });
    expect(attempts.held.map((attempt) => attempt.isFinished)).toEqual([true]);
  });

  it('finishes an attempt whose ships were retired already, by a forming that failed or by hand', async () => {
    for (const ship of ships) {
      ship.isRetired = true;
    }

    await expect(recover()).resolves.toEqual({ isOk: true, value: { recovered: 1, retired: 0 } });
  });
});
