import { createIdGenerator, type FleetId } from '@aeolus-fleet/common';
import { createTRPCClient, httpBatchLink, TRPCClientError, type TRPCClient } from '@trpc/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { sha256Hasher } from '../src/adapters/crypto/secrets.js';
import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createApp } from '../src/app.js';
import type { AppRouter } from '../src/index.js';
import { createUseCases } from '../src/wiring.js';
import { FLEET_URL } from './support/core-fixtures.js';
import { createMigratedDatabase } from './support/database.js';
import { unwrap } from './support/result.js';
import { createTestClock } from './support/postgres-core.js';

// The API from HTTP to Postgres and back: scopes are checked at the door, the
// console session travels as a cookie, and health says nothing about fleets.

const newId = createIdGenerator();
const clock = createTestClock('2026-09-29T12:00:00.000Z');

let database: PrismaClient;
let server: FastifyInstance;
let address: string;
let fleetId: FleetId;
let argoSecret: string;

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  ({ fleetId, secret: argoSecret } = unwrap(
    await createUseCases({ prisma: database, clock, fleetUrl: FLEET_URL }).initialiseFleet({ name: 'home fleet' }),
  ));

  server = createApp({
    databaseUrl,
    publicUrl: FLEET_URL,
    clock,
    logger: false,
    signInRateLimit: { limit: 5, windowMs: 60_000 },
  });
  address = await server.listen({ host: '127.0.0.1', port: 0 });
});

afterAll(async () => {
  await server.close();
  await database.$disconnect();
});

function client(headers: Record<string, string> = {}): TRPCClient<AppRouter> {
  return createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${address}/trpc`, headers })] });
}

async function codeOf(call: Promise<unknown>): Promise<string | undefined> {
  try {
    await call;
  } catch (error) {
    if (error instanceof TRPCClientError) {
      return z.object({ code: z.string() }).safeParse(error.data).data?.code;
    }
    throw error;
  }
  return undefined;
}

/** An agent ship with the two agent scopes and a valid secret, straight into the database (commissioning comes in slice 2). */
async function agentShip(): Promise<string> {
  const shipId = newId('ship');
  const secret = `aeolus_sk_v1_${newId('credential')}`;
  await database.ship.create({
    data: {
      id: shipId,
      fleetId,
      name: `agent-${shipId.slice(-6)}`,
      type: 'reviewer',
      kind: 'agent',
      scopes: ['messages:send', 'messages:receive'],
      createdAt: clock.now(),
    },
  });
  await database.credential.create({
    data: { id: newId('credential'), fleetId, shipId, secretHash: sha256Hasher.hash(secret), issuedAt: clock.now() },
  });
  return secret;
}

async function signIn(secret: string): Promise<Response> {
  return fetch(`${address}/trpc/console.signIn`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ secret }),
  });
}

function sessionCookieOf(response: Response): string {
  const [cookie] = response.headers.getSetCookie();
  return cookie?.split(';')[0] ?? '';
}

describe('the migrations', () => {
  it('are all applied', async () => {
    const applied = await database.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM _prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      ORDER BY migration_name`;

    expect(applied.map((row) => row.migration_name)).toEqual([
      expect.stringMatching(/^\d{14}_init$/),
      expect.stringMatching(/^\d{14}_fleet_argo_console_session$/),
    ]);
  });
});

describe('scopes at the API', () => {
  it('refuse system.ping without a caller', async () => {
    await expect(codeOf(client().system.ping.query())).resolves.toBe('UNAUTHORIZED');
  });

  it('refuse system.ping to an agent ship, which lacks fleet:read', async () => {
    const secret = await agentShip();

    await expect(codeOf(client({ authorization: `Bearer ${secret}` }).system.ping.query())).resolves.toBe('FORBIDDEN');
  });

  it("serve system.ping to argo's secret", async () => {
    await expect(client({ authorization: `Bearer ${argoSecret}` }).system.ping.query()).resolves.toEqual({
      serverTime: '2026-09-29T12:00:00.000Z',
      fleetCount: 1,
    });
  });
});

describe('the console session over HTTP', () => {
  it('signs in with a cookie that serves system.ping', async () => {
    const response = await signIn(argoSecret);
    const cookie = sessionCookieOf(response);

    expect(response.status).toBe(200);
    expect(cookie).toMatch(/^aeolus_session=.+/);
    await expect(client({ cookie }).system.ping.query()).resolves.toMatchObject({ fleetCount: 1 });
  });

  it('stops serving the first cookie after a second sign-in', async () => {
    const first = sessionCookieOf(await signIn(argoSecret));
    const second = sessionCookieOf(await signIn(argoSecret));

    await expect(codeOf(client({ cookie: first }).system.ping.query())).resolves.toBe('UNAUTHORIZED');
    await expect(client({ cookie: second }).system.ping.query()).resolves.toMatchObject({ fleetCount: 1 });
  });

  it('signs out through the tRPC client: the cookie stops working', async () => {
    const cookie = sessionCookieOf(await signIn(argoSecret));

    await client({ cookie }).console.signOut.mutate();

    await expect(codeOf(client({ cookie }).system.ping.query())).resolves.toBe('UNAUTHORIZED');
  });

  it('refuses a wrong secret, then rate-limits the client', async () => {
    clock.advance(60_000);
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      statuses.push((await signIn('aeolus_sk_v1_wrong')).status);
    }

    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    expect((await signIn(argoSecret)).status).toBe(429);
  });
});

describe('/health', () => {
  it('reports server and database up, and nothing about fleets', async () => {
    const response = await fetch(`${address}/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ server: 'up', database: 'up' });
  });

  it('reports 503 when Postgres is unreachable', async () => {
    const unreachable = createApp({
      databaseUrl: 'postgresql://aeolus:aeolus@127.0.0.1:1/aeolus',
      publicUrl: FLEET_URL,
      logger: false,
    });
    try {
      const response = await unreachable.inject({ method: 'GET', url: '/health' });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ server: 'up', database: 'down' });
    } finally {
      await unreachable.close();
    }
  });
});
