import { createIdGenerator, type SendInput, type ShipId } from '@aeolus-fleet/common';
import { createTRPCClient, httpBatchLink, type TRPCClient } from '@trpc/client';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createApp } from '../src/app.js';
import type { Caller } from '../src/core/shared/caller.js';
import type { AppRouter } from '../src/index.js';
import { createUseCases } from '../src/wiring.js';
import { FLEET_URL, OPERATOR, operatorCaller, secretIn } from './support/core-fixtures.js';
import { createMigratedDatabase } from './support/database.js';
import { unwrap } from './support/result.js';

// The server as it runs, from HTTP to Postgres: its listener wakes a waiting
// receive as soon as a send commits, and a delivery survives a stop and a
// start against the same database.

const newId = createIdGenerator();
/** A receive that must end early: it proves a wake-up, not a timeout. */
const LONG_WAIT_MS = 15_000;
/** Time for a receive to start waiting. */
const SETTLE_MS = 300;

let databaseUrl: string;
let database: PrismaClient;
let argo: Caller;
let running: FastifyInstance[];

beforeEach(async () => {
  databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  argo = operatorCaller(
    unwrap(await createUseCases({ prisma: database, fleetUrl: FLEET_URL }).initialiseFleet({ name: 'home fleet', ...OPERATOR })),
  );
  running = [];
});

afterEach(async () => {
  await Promise.all(running.map((server) => server.close()));
  await database.$disconnect();
});

/** Starts the server on the test database and returns its address. */
async function start(receiveWaitMs = LONG_WAIT_MS): Promise<{ server: FastifyInstance; address: string }> {
  const server = createApp({ databaseUrl, publicUrl: FLEET_URL, logger: false, receiveWaitMs });
  running.push(server);
  return { server, address: await server.listen({ host: '127.0.0.1', port: 0 }) };
}

async function stop(server: FastifyInstance): Promise<void> {
  running = running.filter((held) => held !== server);
  await server.close();
}

/** A ship commissioned by argo and claimed through register at the server: its id and crew token. */
async function crewed(address: string, name: string): Promise<{ shipId: ShipId; crewToken: string }> {
  const { shipId, prompt } = unwrap(
    await createUseCases({ prisma: database, fleetUrl: FLEET_URL }).commissionShip(argo, { name, type: 'reviewer' }),
  );
  const { crewToken } = await client(address).ship.register.mutate({
    shipId,
    secret: secretIn(prompt),
    location: { kind: 'DEVICE' },
  });
  return { shipId, crewToken };
}

function client(address: string, crewToken?: string): TRPCClient<AppRouter> {
  const headers: Record<string, string> = crewToken === undefined ? {} : { authorization: `Bearer ${crewToken}` };
  return createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${address}/trpc`, headers })] });
}

function toShipNamed(name: string): SendInput {
  return {
    selector: { kind: 'ship', name },
    payload: 'Review https://github.com/ThomasHendrickx/aeolus-fleet/pull/25',
    contentType: 'text/plain',
    idempotencyKey: `key-${newId('message')}`,
  };
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('the running server', () => {
  it('wakes a waiting receive as soon as a send commits', async () => {
    const { address } = await start();
    const sender = await crewed(address, 'harbour');
    const receiver = await crewed(address, 'mooring');
    const startedAt = performance.now();
    const receiving = client(address, receiver.crewToken).ship.receive.mutate({});
    await pause(SETTLE_MS);

    const { messageId } = await client(address, sender.crewToken).ship.send.mutate(toShipNamed('mooring'));

    await expect(receiving).resolves.toMatchObject({ deliveries: [{ messageId, attempts: 1 }] });
    expect(performance.now() - startedAt).toBeLessThan(LONG_WAIT_MS / 2);
  });

  it('keeps a delivery across a restart: sent before the server stops, received after it starts again', async () => {
    const before = await start();
    const sender = await crewed(before.address, 'harbour');
    const receiver = await crewed(before.address, 'mooring');
    const { messageId } = await client(before.address, sender.crewToken).ship.send.mutate(toShipNamed('mooring'));
    await stop(before.server);

    const after = await start();

    await expect(client(after.address, receiver.crewToken).ship.receive.mutate({})).resolves.toMatchObject({
      deliveries: [{ messageId, senderShipId: sender.shipId, attempts: 1 }],
    });
  });

  it('returns a delivery in flight when the server stopped to the same crew once it starts again', async () => {
    const before = await start();
    const sender = await crewed(before.address, 'harbour');
    const receiver = await crewed(before.address, 'mooring');
    await client(before.address, sender.crewToken).ship.send.mutate(toShipNamed('mooring'));
    const { deliveries } = await client(before.address, receiver.crewToken).ship.receive.mutate({});
    await stop(before.server);

    const after = await start();

    await expect(client(after.address, receiver.crewToken).ship.receive.mutate({})).resolves.toMatchObject({
      deliveries: [{ deliveryId: deliveries[0]?.deliveryId, attempts: 2 }],
    });
  });

});
