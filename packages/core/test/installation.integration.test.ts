import { createIdGenerator, SCOPES, type FleetId, type MessageId, type ShipId } from '@aeolus-fleet/common';
import { createTRPCClient, httpBatchLink, TRPCClientError, type TRPCClient } from '@trpc/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { Prisma } from '../src/adapters/prisma/generated/client.js';
import { createApp } from '../src/app.js';
import type { Caller } from '../src/domain/shared/caller.js';
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

/** As many messages as the demo fleet that could no longer be deleted had (#331), each with its delivery and five events. */
const SEEDED_MESSAGES = 7_500;
const EVENTS_PER_MESSAGE = 5;

/**
 * A fleet's long history, written straight into its tables: copies of one
 * message the fleet sent, each with a copy of its delivery and its events,
 * as thousands of sends would leave them.
 */
async function seedTraffic({ fleetId, from, copies }: { fleetId: FleetId; from: MessageId; copies: number }): Promise<void> {
  // Ids in the format of common/src/ids, numbered past any the generator gives.
  const idOf = (prefix: string) => Prisma.sql`${prefix} || '_7zzzz' || lpad(n::text, 21, '0')`;
  await database.$executeRaw`
    INSERT INTO messages (id, fleet_id, sender_ship_id, selector_kind, selector_ship_id, selector_type, payload, content_type, model,
                          idempotency_key, request_hash, created_at)
    SELECT ${idOf('msg')}, m.fleet_id, m.sender_ship_id, m.selector_kind, m.selector_ship_id, m.selector_type, m.payload, m.content_type, m.model,
           'seeded-' || n, m.request_hash, m.created_at
    FROM messages m, generate_series(1, ${copies}) AS n
    WHERE m.fleet_id = ${fleetId} AND m.id = ${from}`;
  await database.$executeRaw`
    INSERT INTO deliveries (id, fleet_id, message_id, recipient_ship_id, recipient_type, state, attempts, created_at)
    SELECT ${idOf('dlv')}, d.fleet_id, ${idOf('msg')}, d.recipient_ship_id, d.recipient_type, d.state, d.attempts, d.created_at
    FROM deliveries d, generate_series(1, ${copies}) AS n
    WHERE d.fleet_id = ${fleetId} AND d.message_id = ${from}`;
  await database.$executeRaw`
    INSERT INTO events (id, fleet_id, type, occurred_at, actor_ship_id, ship_id, message_id, delivery_id, details, seq)
    SELECT 'evt_7zzz' || lpad((n * ${EVENTS_PER_MESSAGE} + e)::text, 22, '0'), m.fleet_id, 'MessageAccepted', m.created_at,
           m.sender_ship_id, m.selector_ship_id, ${idOf('msg')}, ${idOf('dlv')}, '{}'::jsonb, 1000000 + n * ${EVENTS_PER_MESSAGE} + e
    FROM messages m, generate_series(1, ${copies}) AS n, generate_series(0, ${EVENTS_PER_MESSAGE - 1}) AS e
    WHERE m.fleet_id = ${fleetId} AND m.id = ${from}`;
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
    const machine = unwrap(await core.commissionShip(argo, { idempotencyKey: newKey(), name: 'mac-mini', type: 'trierarch', fleetScopes: ['crew:run'] }));
    unwrap(await core.requestWorktreeClear(argo, { trierarchShipId: machine.shipId, shipId: scout.shipId, repository: 'aeolus-fleet' }));
    const os = unwrap(await core.defineLabel(argo, { key: 'os', values: ['macos'] }));
    unwrap(await core.assignLabel(argo, { shipId: scout.shipId, valueId: os.values[0]?.id ?? createIdGenerator()('labelValue') }));
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

  it('delete a fleet of thousands of messages, deliveries and events within the transaction limit', async () => {
    const created = await installation().create.mutate({ requestId: newKey(), name: 'long-lived', operatorEmail: 'long-lived@example.com' });
    const argo = argoOf(created);
    const { shipId } = unwrap(await core.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
    const { messageId } = unwrap(await core.sendMessage(argo, { selector: { kind: 'ship', shipId }, payload: 'Review', idempotencyKey: newKey() }));
    await seedTraffic({ fleetId: created.fleetId, from: messageId, copies: SEEDED_MESSAGES });
    await expect(rowsOf(created.fleetId)).resolves.toMatchObject({ messages: SEEDED_MESSAGES + 1, deliveries: SEEDED_MESSAGES + 1 });

    await expect(installation().delete.mutate({ requestId: newKey(), fleetId: created.fleetId })).resolves.toEqual({});

    expect(Object.entries(await rowsOf(created.fleetId)).filter(([, count]) => count > 0)).toEqual([]);
  });

  it('are not served as REST', async () => {
    const response = await fetch(`${hostingAddress}/api/v1/installation/fleets/list`, { headers: { 'x-aeolus-installation-token': INSTALLATION_TOKEN } });

    expect(response.status).toBe(404);
  });
});
