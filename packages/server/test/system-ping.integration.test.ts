import { createIdGenerator } from '@aeolus-fleet/common';
import { createTRPCClient, httpBatchLink, type TRPCClient } from '@trpc/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createApp } from '../src/app.js';
import type { AppRouter } from '../src/index.js';
import { createEmptyDatabase, prisma } from './support/database.js';

const serverTime = new Date('2026-09-29T12:00:00.000Z');
const newId = createIdGenerator();

describe('system.ping from HTTP to Postgres and back', () => {
  let database: PrismaClient;
  let server: FastifyInstance;
  let address: string;
  let client: TRPCClient<AppRouter>;

  beforeAll(async () => {
    const databaseUrl = await createEmptyDatabase();
    await prisma(databaseUrl, 'migrate', 'deploy');

    database = createPrismaClient(databaseUrl);
    server = createApp({ databaseUrl, clock: { now: () => serverTime }, logger: false });
    address = await server.listen({ host: '127.0.0.1', port: 0 });
    client = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${address}/trpc` })] });
  });

  afterAll(async () => {
    await server.close();
    await database.$disconnect();
  });

  it('applied every migration', async () => {
    const applied = await database.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM _prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      ORDER BY migration_name`;

    expect(applied.map((row) => row.migration_name)).toEqual([
      expect.stringMatching(/^\d{14}_init$/),
      expect.stringMatching(/^\d{14}_fleet_argo_console_session$/),
    ]);
  });

  it('returns the server time and zero fleets before any fleet exists', async () => {
    await expect(client.system.ping.query()).resolves.toEqual({
      serverTime: '2026-09-29T12:00:00.000Z',
      fleetCount: 0,
    });
  });

  it('counts the fleets in the database', async () => {
    await database.fleet.create({ data: { id: newId('fleet'), name: 'first', createdAt: serverTime } });
    await database.fleet.create({ data: { id: newId('fleet'), name: 'second', createdAt: serverTime } });

    await expect(client.system.ping.query()).resolves.toMatchObject({ fleetCount: 2 });
  });

  it('reports ok on /health', async () => {
    const response = await fetch(`${address}/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
  });
});

describe('/health without a database', () => {
  it('reports 503 when Postgres is unreachable', async () => {
    const server = createApp({ databaseUrl: 'postgresql://aeolus:aeolus@127.0.0.1:1/aeolus', logger: false });
    try {
      const response = await server.inject({ method: 'GET', url: '/health' });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ status: 'unavailable' });
    } finally {
      await server.close();
    }
  });
});
