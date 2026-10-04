import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaManagementCrewStore } from '../src/adapters/prisma/management-crew-store.js';
import type { ManagementCrew } from '../src/core/management/ports.js';
import { createSquadronsDatabase } from './support/database.js';

// Each fleet's management ship crew token, in Postgres: one connection per
// fleet in one install, the binding kept when the crew token is dropped.

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const SHIP: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h1a';
const OTHER_SHIP: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h1b';
const AT = new Date('2026-10-04T09:00:00.000Z');

let prisma: PrismaClient;

function aCrew(fleetId: FleetId, overrides: Partial<ManagementCrew> = {}): ManagementCrew {
  return { fleetId, shipId: fleetId === FLEET ? SHIP : OTHER_SHIP, name: 'squadrons', crewToken: `aeolus_ct_v1_${fleetId}`, crewedAt: AT, ...overrides };
}

beforeEach(async () => {
  prisma = createPrismaClient(await createSquadronsDatabase());
});

afterEach(async () => {
  await prisma.$disconnect();
});

describe('the management crew store', () => {
  it('keeps one connection per fleet: each fleet finds its own crew, and both are connected', async () => {
    const store = createPrismaManagementCrewStore(prisma);
    await store.save(aCrew(FLEET));
    await store.save(aCrew(OTHER_FLEET));

    await expect(store.find(FLEET)).resolves.toEqual(aCrew(FLEET));
    await expect(store.find(OTHER_FLEET)).resolves.toEqual(aCrew(OTHER_FLEET));
    await expect(store.connected().then((crews) => crews.map((crew) => crew.fleetId).sort())).resolves.toEqual([FLEET, OTHER_FLEET].sort());
  });

  it("drops one fleet's crew token, keeping its binding, and leaves another fleet's connection as it was", async () => {
    const store = createPrismaManagementCrewStore(prisma);
    await store.save(aCrew(FLEET));
    await store.save(aCrew(OTHER_FLEET));

    await store.drop(FLEET);

    await expect(store.find(FLEET)).resolves.toBeUndefined();
    await expect(store.binding(FLEET)).resolves.toEqual({ fleetId: FLEET, shipId: SHIP });
    await expect(store.find(OTHER_FLEET)).resolves.toEqual(aCrew(OTHER_FLEET));
    await expect(store.connected().then((crews) => crews.map((crew) => crew.fleetId))).resolves.toEqual([OTHER_FLEET]);
  });

  it("connects a fleet again as another ship, replacing that fleet's connection only", async () => {
    const store = createPrismaManagementCrewStore(prisma);
    await store.save(aCrew(FLEET));
    await store.drop(FLEET);

    await store.save(aCrew(FLEET, { shipId: OTHER_SHIP, crewToken: 'aeolus_ct_v1_again' }));

    await expect(store.find(FLEET)).resolves.toEqual(aCrew(FLEET, { shipId: OTHER_SHIP, crewToken: 'aeolus_ct_v1_again' }));
  });

  it('holds nothing for a fleet never connected', async () => {
    const store = createPrismaManagementCrewStore(prisma);
    await store.save(aCrew(FLEET));

    await expect(store.find(OTHER_FLEET)).resolves.toBeUndefined();
    await expect(store.binding(OTHER_FLEET)).resolves.toBeUndefined();
  });
});
