import type { ShipId } from '@aeolus-fleet/common';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createApp } from '../../server/src/app.js';
import { createPrismaClient, type PrismaClient } from '../../server/src/adapters/prisma/client.js';
import { createUseCases } from '../../server/src/wiring.js';
import { FLEET_URL, OPERATOR, operatorCaller, secretIn } from '../../server/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../../server/test/support/database.js';
import { unwrap } from '../../server/test/support/result.js';
import { createSquadronsApp, type SquadronsApp } from '../src/app.js';
import { createSquadronsDatabase } from './support/database.js';

// squadrons against a real fleet: it crews its management ship with the
// secret once, keeps the crew token in its own database, crews it again with
// that token after a restart, and answers its own health and version.

let fleetDatabase: PrismaClient;
let fleet: FastifyInstance;
let fleetUrl: string;
let squadronsDatabaseUrl: string;
let shipId: ShipId;
let secret: string;
const apps: SquadronsApp[] = [];

beforeEach(async () => {
  const fleetDatabaseUrl = await createMigratedDatabase();
  fleetDatabase = createPrismaClient(fleetDatabaseUrl);
  const useCases = createUseCases({ prisma: fleetDatabase, fleetUrl: FLEET_URL });
  const argo = operatorCaller(unwrap(await useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR })));
  const commissioned = unwrap(
    await useCases.commissionShip(argo, { name: 'squadrons', type: 'squadrons', fleetScopes: ['fleet:read', 'fleet:manage'] }),
  );
  shipId = commissioned.shipId;
  secret = secretIn(commissioned.prompt);
  fleet = createApp({ databaseUrl: fleetDatabaseUrl, publicUrl: FLEET_URL, logger: false });
  fleetUrl = await fleet.listen({ host: '127.0.0.1', port: 0 });
  squadronsDatabaseUrl = await createSquadronsDatabase();
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await fleet.close();
  await fleetDatabase.$disconnect();
});

function squadrons(managementSecret: string | undefined): SquadronsApp {
  const app = createSquadronsApp({
    databaseUrl: squadronsDatabaseUrl,
    fleetUrl,
    managementShip: { shipId, secret: managementSecret },
    repositories: [],
    cacheDir: '/tmp/aeolus-squadrons-unused',
    logger: false,
  });
  apps.push(app);
  return app;
}

async function leaseCount(): Promise<number> {
  return fleetDatabase.lease.count({ where: { shipId } });
}

describe('the management ship', () => {
  it('is crewed with its secret, as a server, and named as the fleet names it', async () => {
    await expect(squadrons(secret).crewManagementShip()).resolves.toMatchObject({ isOk: true, value: { name: 'squadrons' } });

    await expect(fleetDatabase.lease.findFirstOrThrow({ where: { shipId, endedAt: null } })).resolves.toMatchObject({
      location: 'SERVER',
    });
  });

  it('is crewed again after a restart with the kept crew token, without the secret and without a new lease', async () => {
    unwrap(await squadrons(secret).crewManagementShip());
    await apps.splice(0)[0]?.close();

    await expect(squadrons(undefined).crewManagementShip()).resolves.toMatchObject({ isOk: true });
    await expect(leaseCount()).resolves.toBe(1);
  });
});

describe('the squadrons API', () => {
  it('answers its health and its version with its latest migration', async () => {
    const app = squadrons(secret);
    const address = await app.server.listen({ host: '127.0.0.1', port: 0 });

    const health = await fetch(`${address}/api/health`);
    const version = z
      .object({ squadrons: z.string(), migration: z.string() })
      .parse(await (await fetch(`${address}/api/version`)).json());

    expect(health.status).toBe(200);
    expect(version.squadrons).toMatch(/^\d+\.\d+\.\d+/);
    expect(version.migration).toMatch(/^\d{14}_squadrons$/);
  });
});
