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
import { connectSquadrons, signIn } from './support/connection.js';
import { createSquadronsDatabase } from './support/database.js';
import { newKey } from '../../server/test/support/keys.js';

// squadrons against a real fleet: it starts not connected, with no secret
// anywhere; the operator connects it, it keeps the crew token in its own
// database and is connected again after a restart, and a released management
// ship leaves it not connected. Its health and version say which.

let fleetDatabase: PrismaClient;
let fleet: FastifyInstance;
let fleetUrl: string;
let squadronsDatabaseUrl: string;
let useCases: ReturnType<typeof createUseCases>;
let argo: ReturnType<typeof operatorCaller>;
let shipId: ShipId;
let secret: string;
let cookie: string;
const apps: SquadronsApp[] = [];

beforeEach(async () => {
  const fleetDatabaseUrl = await createMigratedDatabase();
  fleetDatabase = createPrismaClient(fleetDatabaseUrl);
  useCases = createUseCases({ prisma: fleetDatabase, fleetUrl: FLEET_URL });
  argo = operatorCaller(unwrap(await useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR })));
  const commissioned = unwrap(
    await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'squadrons', type: 'squadrons', fleetScopes: ['fleet:read', 'fleet:manage'] }),
  );
  shipId = commissioned.shipId;
  secret = secretIn(commissioned.prompt);
  fleet = createApp({ databaseUrl: fleetDatabaseUrl, publicUrl: FLEET_URL, logger: false });
  fleetUrl = await fleet.listen({ host: '127.0.0.1', port: 0 });
  cookie = await signIn(fleetUrl);
  squadronsDatabaseUrl = await createSquadronsDatabase();
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await fleet.close();
  await fleetDatabase.$disconnect();
});

/** A squadrons process on the test's database, serving on a free port. */
async function started(): Promise<{ app: SquadronsApp; address: string }> {
  const app = createSquadronsApp({ databaseUrl: squadronsDatabaseUrl, fleetUrl, repositories: [], cacheDir: '/tmp/aeolus-squadrons-unused', logger: false });
  apps.push(app);
  await app.readConnection();
  return { app, address: await app.server.listen({ host: '127.0.0.1', port: 0 }) };
}

const statusSchema = z.object({
  result: z.object({ data: z.object({ state: z.string(), ship: z.object({ shipId: z.string(), name: z.string() }).nullable(), lastShipId: z.string().nullable() }) }),
});

async function status(address: string) {
  return statusSchema.parse(await (await fetch(`${address}/trpc/connection.status`, { headers: { cookie } })).json()).result.data;
}

async function healthOf(address: string) {
  const response = await fetch(`${address}/api/health`);
  return { status: response.status, body: z.object({ status: z.string(), connection: z.string() }).parse(await response.json()) };
}

describe('a squadrons process that was never connected', () => {
  it('starts not connected, and its health and version say so', async () => {
    const { address } = await started();

    await expect(status(address)).resolves.toEqual({ state: 'not-connected', ship: null, lastShipId: null });
    await expect(healthOf(address)).resolves.toEqual({ status: 200, body: { status: 'ok', connection: 'not-connected' } });
    const version = z.object({ squadrons: z.string(), migration: z.string(), connection: z.string() }).parse(await (await fetch(`${address}/api/version`)).json());
    expect(version.connection).toBe('not-connected');
    expect(version.migration).toMatch(/^\d{14}_member_stand_down$/);
    expect(version.squadrons).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('refuses the catalogue and the squadrons until it is connected', async () => {
    const { address } = await started();

    const catalogue = await fetch(`${address}/trpc/catalogue.list`, { headers: { cookie } });

    expect(catalogue.status).toBe(412);
  });
});

describe('connecting squadrons', () => {
  it('registers the management ship with the secret, as a server, and is connected as it', async () => {
    const { address } = await started();

    const connected = await connectSquadrons(address, { cookie, shipId, secret });

    expect(connected.status, await connected.clone().text()).toBe(200);
    await expect(status(address)).resolves.toEqual({ state: 'connected', ship: { shipId, name: 'squadrons' }, lastShipId: shipId });
    await expect(healthOf(address)).resolves.toMatchObject({ body: { connection: 'connected' } });
    await expect(fleetDatabase.lease.findFirstOrThrow({ where: { shipId, endedAt: null } })).resolves.toMatchObject({ location: 'SERVER' });
  });

  it('is refused without a console session of the fleet', async () => {
    const { address } = await started();

    await expect(connectSquadrons(address, { cookie: 'aeolus_session=forged', shipId, secret }).then((response) => response.status)).resolves.toBe(401);
  });

  it('is refused for a ship without fleet:manage', async () => {
    const reader = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'reader', type: 'squadrons', fleetScopes: ['fleet:read'] }));
    const { address } = await started();

    const refused = await connectSquadrons(address, { cookie, shipId: reader.shipId, secret: secretIn(reader.prompt) });

    expect(refused.status).toBe(400);
    await expect(status(address)).resolves.toMatchObject({ state: 'not-connected' });
  });

  it('is connected again after a restart with the kept crew token, without a new lease', async () => {
    const first = await started();
    expect((await connectSquadrons(first.address, { cookie, shipId, secret })).status).toBe(200);
    await apps.splice(0)[0]?.close();

    const { address } = await started();

    await expect(status(address)).resolves.toMatchObject({ state: 'connected' });
    await expect(fleetDatabase.lease.count({ where: { shipId } })).resolves.toBe(1);
  });

  it('is not connected once the operator released the management ship, and names it as the last one', async () => {
    const { address } = await started();
    expect((await connectSquadrons(address, { cookie, shipId, secret })).status).toBe(200);

    unwrap(await useCases.releaseShip(argo, { shipId }));

    await expect(status(address)).resolves.toEqual({ state: 'not-connected', ship: null, lastShipId: shipId });
    await expect(healthOf(address)).resolves.toMatchObject({ body: { connection: 'not-connected' } });
  });
});
