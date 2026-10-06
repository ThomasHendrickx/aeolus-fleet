import { SCOPES, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { createTRPCClient, httpBatchLink, TRPCClientError, type TRPCClient } from '@trpc/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

// The installation API from HTTP to Postgres and back: a hosting service such
// as pagasae creates, describes and deletes fleets with the installation token.

const INSTALLATION_TOKEN = 'aeolus_installation_test_0123456789abcdef';
const clock = createTestClock('2026-10-04T12:00:00.000Z');

let databaseUrl: string;
let database: PrismaClient;
let core: UseCases;
let hosting: FastifyInstance;
let selfHosted: FastifyInstance;
let hostingAddress: string;
let selfHostedAddress: string;
let homeFleet: FleetId;

beforeAll(async () => {
  databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  core = createUseCases({ prisma: database, clock });
  ({ fleetId: homeFleet } = unwrap(await core.initialiseFleet({ name: 'home fleet', ...OPERATOR })));
  hosting = createApp({ databaseUrl, publicUrl: FLEET_URL, clock, logger: false, installationToken: INSTALLATION_TOKEN });
  hostingAddress = await hosting.listen({ host: '127.0.0.1', port: 0 });
  selfHosted = createApp({ databaseUrl, publicUrl: FLEET_URL, clock, logger: false });
  selfHostedAddress = await selfHosted.listen({ host: '127.0.0.1', port: 0 });
});

afterAll(async () => {
  await hosting.close();
  await selfHosted.close();
  await database.$disconnect();
});

function client(address: string, token?: string): TRPCClient<AppRouter> {
  const headers: Record<string, string> = token === undefined ? {} : { 'x-aeolus-installation-token': token };
  return createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${address}/trpc`, headers })] });
}

const installation = () => client(hostingAddress, INSTALLATION_TOKEN).installation.fleets;

/** The tRPC error code a call fails with; undefined when it succeeds. */
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

/** argo of a fleet as the caller, as its console session makes it. */
function argoOf(fleet: { fleetId: FleetId; operatorShipId: ShipId }): Caller {
  return { fleetId: fleet.fleetId, shipId: fleet.operatorShipId, kind: 'operator', scopes: [...SCOPES] };
}

/** How many rows every table holds for the fleet: each table with a fleet_id column, and the fleet itself. */
async function rowsOf(fleetId: FleetId): Promise<Record<string, number>> {
  const tables = z
    .array(z.object({ table_name: z.string() }))
    .parse(await database.$queryRaw`SELECT table_name FROM information_schema.columns WHERE table_schema = current_schema() AND column_name = 'fleet_id' ORDER BY table_name`);
  const counts: Record<string, number> = {};
  for (const { table_name: table } of tables) {
    const [row] = z.array(z.object({ count: z.bigint() })).parse(await database.$queryRawUnsafe(`SELECT count(*) AS count FROM "${table}" WHERE fleet_id = $1`, fleetId));
    counts[table] = Number(row?.count ?? 0n);
  }
  const [fleet] = z.array(z.object({ count: z.bigint() })).parse(await database.$queryRaw`SELECT count(*) AS count FROM fleets WHERE id = ${fleetId}`);
  counts.fleets = Number(fleet?.count ?? 0n);
  return counts;
}

describe('the installation procedures on a server without an installation token', () => {
  it('are not there: every one answers NOT_FOUND, even with a token', async () => {
    const fleets = client(selfHostedAddress, INSTALLATION_TOKEN).installation.fleets;

    await expect(codeOf(fleets.list.query())).resolves.toBe('NOT_FOUND');
    await expect(codeOf(fleets.get.query({ fleetId: homeFleet }))).resolves.toBe('NOT_FOUND');
    await expect(codeOf(fleets.create.mutate({ requestId: newKey(), name: 'hemma', operatorEmail: 'nobody@example.com' }))).resolves.toBe('NOT_FOUND');
    await expect(codeOf(fleets.delete.mutate({ requestId: newKey(), fleetId: homeFleet }))).resolves.toBe('NOT_FOUND');
    await expect(database.fleet.count()).resolves.toBe(1);
  });
});

describe('the installation procedures on a hosting server', () => {
  it('refuse a missing or wrong installation token', async () => {
    await expect(codeOf(client(hostingAddress).installation.fleets.list.query())).resolves.toBe('UNAUTHORIZED');
    await expect(codeOf(client(hostingAddress, `${INSTALLATION_TOKEN}x`).installation.fleets.list.query())).resolves.toBe('UNAUTHORIZED');
  });

  it('create a fleet that works: its argo commissions a ship on Postgres', async () => {
    const created = await installation().create.mutate({ requestId: newKey(), name: 'hemma', operatorEmail: 'lena@example.com' });

    const commissioned = unwrap(await core.commissionShip(argoOf(created), { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));

    await expect(database.ship.findFirst({ where: { fleetId: created.fleetId, id: commissioned.shipId } })).resolves.toMatchObject({ name: 'scout' });
    await expect(database.operator.findFirst({ where: { fleetId: created.fleetId } })).resolves.toMatchObject({ email: 'lena@example.com', passwordHash: null });
  });

  it('answer a create replayed under its request id with the same fleet, and refuse a taken email', async () => {
    const request = { requestId: newKey(), name: 'replayed', operatorEmail: 'replay@example.com' };
    const first = await installation().create.mutate(request);

    await expect(installation().create.mutate(request)).resolves.toEqual(first);
    await expect(codeOf(installation().create.mutate({ ...request, requestId: newKey() }))).resolves.toBe('CONFLICT');
  });

  it('describe a fleet: its operator, measures, messages today and per UTC day, and the limits that apply', async () => {
    const created = await installation().create.mutate({ requestId: newKey(), name: 'busy', operatorEmail: 'busy@example.com' });
    const argo = argoOf(created);
    const { shipId } = unwrap(await core.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
    unwrap(await core.sendMessage(argo, { selector: { kind: 'ship', shipId }, payload: 'Review the pull request', idempotencyKey: newKey() }));

    const described = await installation().get.query({ fleetId: created.fleetId });

    expect(described).toEqual({
      fleetId: created.fleetId,
      name: 'busy',
      operatorEmail: 'busy@example.com',
      createdAt: clock.now().toISOString(),
      shipCount: 2,
      messagesLast7Days: 1,
      lastActivityAt: clock.now().toISOString(),
      // The UTF-8 bytes of its one payload: "Review the pull request".
      storage: 23,
      messagesToday: 1,
      messagesPerDay: ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'].map((date) => ({ date, count: date === '2026-10-04' ? 1 : 0 })),
      limits: { ships: { setting: { kind: 'default' }, applies: null }, dailyMessages: { setting: { kind: 'default' }, applies: null } },
    });
    await expect(installation().list.query()).resolves.toContainEqual(described);
  });

  it('delete a busy fleet and leave no row with its fleet_id, and every other fleet as it was', async () => {
    const created = await installation().create.mutate({ requestId: newKey(), name: 'doomed', operatorEmail: 'doomed@example.com' });
    const argo = argoOf(created);
    const scout = unwrap(await core.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
    unwrap(await core.requestCrew(argo, { shipId: scout.shipId, settings: { harness: 'claude-code' } }));
    const { crewToken } = unwrap(await core.claimShip({ shipId: scout.shipId, secret: scout.secret ?? '', location: { kind: 'CLOUD' }, harness: 'claude-code' }));
    const crew = unwrap(await core.authenticate.byCrewToken(crewToken));
    const asked = unwrap(await core.sendMessage(argo, { selector: { kind: 'ship', shipId: scout.shipId }, payload: 'Review', idempotencyKey: newKey() }));
    unwrap(await core.receiveDeliveries(crew, {}));
    unwrap(await core.sendMessage(crew, { selector: { kind: 'ship', name: 'argo' }, payload: 'On it', model: 'claude-opus-5-5', inReplyTo: asked.messageId, idempotencyKey: newKey() }));
    // Its operator signed in with a ticket, so a console session, argo's lease and a used ticket exist too.
    const { ticket } = await client(hostingAddress, INSTALLATION_TOKEN).installation.operators.issueSignInTicket.mutate({ fleetId: created.fleetId });
    unwrap(await core.redeemSignInTicket({ ticket }));
    const homeBefore = await rowsOf(homeFleet);

    await expect(installation().delete.mutate({ requestId: 'delete-doomed', fleetId: created.fleetId })).resolves.toEqual({});

    expect(Object.entries(await rowsOf(created.fleetId)).filter(([, count]) => count > 0)).toEqual([]);
    await expect(rowsOf(homeFleet)).resolves.toEqual(homeBefore);
    await expect(codeOf(installation().get.query({ fleetId: created.fleetId }))).resolves.toBe('NOT_FOUND');
    await expect(installation().delete.mutate({ requestId: 'delete-doomed', fleetId: created.fleetId })).resolves.toEqual({});
    await expect(codeOf(installation().delete.mutate({ requestId: newKey(), fleetId: created.fleetId }))).resolves.toBe('NOT_FOUND');
  });

  it('are not served as REST', async () => {
    const response = await fetch(`${hostingAddress}/api/v1/installation/fleets/list`, { headers: { 'x-aeolus-installation-token': INSTALLATION_TOKEN } });

    expect(response.status).toBe(404);
  });
});
