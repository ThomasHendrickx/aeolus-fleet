import { SCOPES, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { createTRPCClient, httpBatchLink, TRPCClientError } from '@trpc/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createApp } from '../src/app.js';
import type { Caller } from '../src/core/shared/caller.js';
import type { AppRouter } from '../src/index.js';
import { createUseCases, type UseCases } from '../src/wiring.js';
import { FLEET_URL, OPERATOR } from './support/core-fixtures.js';
import { createMigratedDatabase } from './support/database.js';
import { newKey } from './support/keys.js';
import { createTestClock } from './support/postgres-core.js';
import { unwrap } from './support/result.js';

// Limits as fleet settings, from HTTP to Postgres and back: the installation
// sets them, the console reads them, and commission, send and create are
// refused exactly at them, however many race for the last place.

const INSTALLATION_TOKEN = 'aeolus_installation_test_0123456789abcdef';
const MODEL = 'claude-opus-5-5';
const clock = createTestClock('2026-10-04T12:00:00.000Z');

let database: PrismaClient;
let core: UseCases;
let server: FastifyInstance;
let address: string;
let homeFleet: FleetId;
let homeArgo: ShipId;

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  core = createUseCases({ prisma: database, clock });
  ({ fleetId: homeFleet, operatorShipId: homeArgo } = unwrap(await core.initialiseFleet({ name: 'home fleet', ...OPERATOR })));
  server = createApp({ databaseUrl, publicUrl: FLEET_URL, clock, logger: false, installationToken: INSTALLATION_TOKEN });
  address = await server.listen({ host: '127.0.0.1', port: 0 });
});

beforeEach(async () => {
  await installation().settings.set.mutate({ defaultShipLimit: null, defaultDailyMessageLimit: null, fleetCap: null });
});

afterAll(async () => {
  await server.close();
  await database.$disconnect();
});

function installation() {
  return createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${address}/trpc`, headers: { 'x-aeolus-installation-token': INSTALLATION_TOKEN } })] }).installation;
}

function argoOf(fleet: { fleetId: FleetId; operatorShipId: ShipId }): Caller {
  return { fleetId: fleet.fleetId, shipId: fleet.operatorShipId, kind: 'operator', scopes: [...SCOPES] };
}

/** A fleet of its own for a test, created through the installation. */
async function newFleet(name: string) {
  return installation().fleets.create.mutate({ requestId: newKey(), name, operatorEmail: `${name}@example.com` });
}

/** The tRPC error code and message a call fails with; undefined when it succeeds. */
async function refusalOf(call: Promise<unknown>): Promise<{ code: string | undefined; message: string } | undefined> {
  try {
    await call;
  } catch (error) {
    if (error instanceof TRPCClientError) {
      return { code: z.object({ code: z.string() }).safeParse(error.data).data?.code, message: error.message };
    }
    throw error;
  }
  return undefined;
}

describe("the installation's settings", () => {
  it('are no limit until set, and keep what is set', async () => {
    await expect(installation().settings.get.query()).resolves.toEqual({ defaultShipLimit: null, defaultDailyMessageLimit: null, fleetCap: null });

    await installation().settings.set.mutate({ defaultShipLimit: 10, defaultDailyMessageLimit: 1000, fleetCap: 50 });

    await expect(installation().settings.get.query()).resolves.toEqual({ defaultShipLimit: 10, defaultDailyMessageLimit: 1000, fleetCap: 50 });
  });
});

describe("a fleet's limits", () => {
  it('follow the defaults until set for the fleet, and go back to them', async () => {
    const { fleetId } = await newFleet('limited');
    await installation().settings.set.mutate({ defaultShipLimit: 10, defaultDailyMessageLimit: 1000, fleetCap: null });

    await expect(installation().fleets.setLimits.mutate({ fleetId, ships: { kind: 'fleet', limit: 25 }, dailyMessages: { kind: 'fleet', limit: null } })).resolves.toEqual({
      fleetId,
      ships: { setting: { kind: 'fleet', limit: 25 }, applies: 25 },
      dailyMessages: { setting: { kind: 'fleet', limit: null }, applies: null },
    });
    await installation().fleets.setLimits.mutate({ fleetId, ships: { kind: 'default' } });
    await expect(installation().fleets.limits.query({ fleetId })).resolves.toMatchObject({ ships: { setting: { kind: 'default' }, applies: 10 } });
  });

  it('are read by the console with what each counts', async () => {
    await installation().settings.set.mutate({ defaultShipLimit: 10, defaultDailyMessageLimit: 1000, fleetCap: null });
    const signedIn = await fetch(`${address}/trpc/console.signIn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: new URL(FLEET_URL).origin },
      body: JSON.stringify(OPERATOR),
    });
    const cookie = signedIn.headers.get('set-cookie')?.split(';')[0] ?? '';
    const console = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${address}/trpc`, headers: { cookie } })] });

    const limits = await console.fleet.limits.query();

    expect(limits.ships.limit).toBe(10);
    expect(limits.ships.count).toBe(await database.ship.count({ where: { fleetId: homeFleet, retiredAt: null } }));
    expect(limits.dailyMessages).toMatchObject({ limit: 1000, resetsAt: '2026-10-05T00:00:00.000Z' });
  });
});

describe('the limits at their boundary', () => {
  it('commission ships up to the limit, argo included, however many race, and refuse the rest saying so', async () => {
    const fleet = await newFleet('shipyard');
    await installation().fleets.setLimits.mutate({ fleetId: fleet.fleetId, ships: { kind: 'fleet', limit: 4 } });

    const results = await Promise.all(
      Array.from({ length: 6 }, (_unused, index) => core.commissionShip(argoOf(fleet), { idempotencyKey: newKey(), name: `ship-${String(index)}`, type: 'reviewer' })),
    );

    expect(results.filter((result) => result.isOk)).toHaveLength(3);
    expect(results.flatMap((result) => (result.isOk ? [] : [result.error]))).toEqual(
      Array.from({ length: 3 }, () => ({ kind: 'SHIP_LIMIT_REACHED', message: 'The fleet is at its limit of 4 ships, so it takes no new one.' })),
    );
    await expect(database.ship.count({ where: { fleetId: fleet.fleetId, retiredAt: null } })).resolves.toBe(4);
  });

  it('take sends up to the daily limit however many race, store nothing more, and refuse over HTTP saying so', async () => {
    const fleet = await newFleet('busy');
    await installation().fleets.setLimits.mutate({ fleetId: fleet.fleetId, dailyMessages: { kind: 'fleet', limit: 3 } });
    const argo = argoOf(fleet);

    const results = await Promise.all(
      Array.from({ length: 8 }, () => core.sendMessage(argo, { selector: { kind: 'ship', name: 'argo' }, payload: 'Note', idempotencyKey: newKey() })),
    );

    expect(results.filter((result) => result.isOk)).toHaveLength(3);
    await expect(database.message.count({ where: { fleetId: fleet.fleetId } })).resolves.toBe(3);
    const { shipId, secret } = unwrap(await core.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
    const { crewToken } = unwrap(await core.claimShip({ shipId, secret: secret ?? '', location: { kind: 'CLOUD' }, harness: 'claude-code' }));
    const asScout = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${address}/trpc`, headers: { authorization: `Bearer ${crewToken}` } })] });
    await expect(refusalOf(asScout.ship.send.mutate({ selector: { kind: 'ship', name: 'argo' }, payload: 'Done', model: MODEL, idempotencyKey: newKey() }))).resolves.toEqual({
      code: 'FORBIDDEN',
      message: 'The fleet reached its limit of 3 messages today (UTC), so nothing was stored. Sending works again after 00:00 UTC.',
    });
    await expect(database.message.count({ where: { fleetId: fleet.fleetId } })).resolves.toBe(3);
  });

  it('create fleets up to the cap however many race, and refuse the rest', async () => {
    const hosted = await database.fleet.count();
    await installation().settings.set.mutate({ defaultShipLimit: null, defaultDailyMessageLimit: null, fleetCap: hosted + 2 });

    const results = await Promise.all(
      Array.from({ length: 5 }, (_unused, index) => refusalOf(installation().fleets.create.mutate({ requestId: newKey(), name: `capped-${String(index)}`, operatorEmail: `capped-${String(index)}@example.com` }))),
    );

    expect(results.filter((result) => result === undefined)).toHaveLength(2);
    expect(results.filter((result) => result !== undefined)).toEqual(
      Array.from({ length: 3 }, () => ({ code: 'FORBIDDEN', message: `The installation is at its cap of ${String(hosted + 2)} fleets, so it creates no new one.` })),
    );
    await expect(database.fleet.count()).resolves.toBe(hosted + 2);
  });

  it('change nothing while none is set', async () => {
    const argo: Caller = { fleetId: homeFleet, shipId: homeArgo, kind: 'operator', scopes: [...SCOPES] };

    const sends = await Promise.all(Array.from({ length: 5 }, () => core.sendMessage(argo, { selector: { kind: 'ship', name: 'argo' }, payload: 'Note', idempotencyKey: newKey() })));

    expect(sends.every((result) => result.isOk)).toBe(true);
  });
});
