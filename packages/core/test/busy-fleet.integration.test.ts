import { randomBytes } from 'node:crypto';
import { connect, createServer, type Socket } from 'node:net';

import type { SendInput } from '@aeolus-fleet/common';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { LISTENER_APPLICATION_NAME } from '../src/adapters/prisma/delivery-notices.js';
import { createApp } from '../src/app.js';
import type { ShipCaller } from '../src/domain/shared/caller.js';
import { createUseCases } from '../src/wiring.js';
import { FLEET_URL, OPERATOR, operatorCaller, secretOf } from './support/core-fixtures.js';
import { createMigratedDatabase } from '../src/testing/database.js';
import { newKey } from '../src/testing/keys.js';
import { unwrap } from '../src/testing/result.js';
import { withOperatorLogin } from './support/operator-login.js';

// Every call runs in one transaction on a pool of 10 connections. Here each
// send holds its connection for 3 s, so 200 sends at once are a minute of
// work. A send also waits in the same pool to look up its crew token, so on a
// loaded machine the sends reach their transactions spread out; even so the
// later ones wait well past the 10 s a transaction waits for a connection and
// must be refused as busy, with nothing stored. A call that cannot even get
// a connection to look up its crew token in that time is refused the same way.

/** How long each send holds its connection. */
const SEND_HOLDS_SECONDS = 3;
/** Enough sends at once that the later ones wait past 10 s for a connection, however loaded the machine. */
const SENDS_AT_ONCE = 200;

const BUSY_REFUSAL = {
  code: 'SERVICE_UNAVAILABLE',
  message: 'The fleet is busy; nothing was stored. Make the same call again (for send, with the same idempotency key).',
};

/** How long a crew-token lookup holds its connection: well past the 10 s a call waits for one. */
const LOOKUP_HOLDS_SECONDS = 20;
/** pg's default pool size: this many held lookups leave no connection free. */
const POOL_SIZE = 10;

/** Makes every crew-token lookup but the given ship's hold its connection for a while. */
async function slowLookupsExceptFor(database: PrismaClient, shipId: string): Promise<void> {
  await database.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION hold_lookup() RETURNS trigger AS $$ BEGIN PERFORM pg_sleep(${LOOKUP_HOLDS_SECONDS}); RETURN NEW; END $$ LANGUAGE plpgsql`,
  );
  // The id is one the fleet gave, never outside input.
  await database.$executeRawUnsafe(
    `CREATE OR REPLACE TRIGGER hold_lookup BEFORE UPDATE ON leases FOR EACH ROW WHEN (NEW.ship_id <> '${shipId}') EXECUTE FUNCTION hold_lookup()`,
  );
}

/** Waits until the given number of crew-token lookups hold their connections. */
async function untilLookupsHeld(database: PrismaClient, count: number): Promise<void> {
  for (;;) {
    const [row] = await database.$queryRaw<{ held: bigint }[]>`
      SELECT count(*) AS held FROM pg_stat_activity
      WHERE datname = current_database() AND state = 'active' AND query LIKE '%crew_token_hash%' AND pid <> pg_backend_pid()`;
    if (row !== undefined && Number(row.held) >= count) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Waits until a console call's use of its session waits on the session's row. */
async function untilSessionUseWaits(database: PrismaClient): Promise<void> {
  for (;;) {
    const [row] = await database.$queryRaw<{ waiting: bigint }[]>`
      SELECT count(*) AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%console_sessions%' AND pid <> pg_backend_pid()`;
    if (row !== undefined && Number(row.waiting) >= 1) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Makes every message insert hold its transaction, and so its connection, for a while. */
async function slowMessageInserts(database: PrismaClient): Promise<void> {
  await database.$executeRawUnsafe(
    `CREATE FUNCTION hold_message() RETURNS trigger AS $$ BEGIN PERFORM pg_sleep(${SEND_HOLDS_SECONDS}); RETURN NEW; END $$ LANGUAGE plpgsql`,
  );
  await database.$executeRawUnsafe(
    'CREATE TRIGGER hold_message BEFORE INSERT ON messages FOR EACH ROW EXECUTE FUNCTION hold_message()',
  );
}

describe('a fleet whose connections are all in use', () => {
  let database: PrismaClient;
  let argo: ShipCaller;
  let server: FastifyInstance;
  let address: string;

  beforeAll(async () => {
    const databaseUrl = await createMigratedDatabase();
    database = createPrismaClient(databaseUrl);
    argo = operatorCaller(
      unwrap(await withOperatorLogin(database, createUseCases({ prisma: database }).initialiseFleet({ name: 'home fleet' }))),
    );
    server = createApp({ databaseUrl, publicUrl: FLEET_URL, logger: false });
    address = await server.listen({ host: '127.0.0.1', port: 0 });
  });

  afterAll(async () => {
    await server.close();
    await database.$disconnect();
  });

  /** A ship commissioned by argo and crewed through REST: its crew token. */
  async function crewToken(name: string): Promise<string> {
    return (await crewedShip(name)).crewToken;
  }

  /** A ship commissioned by argo and crewed through REST: its id and crew token. */
  async function crewedShip(name: string): Promise<{ shipId: string; crewToken: string }> {
    const { shipId, secret } = unwrap(
      await createUseCases({ prisma: database }).commissionShip(argo, { idempotencyKey: newKey(), name, type: 'reviewer' }),
    );
    const response = await fetch(`${address}/api/v1/ship/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shipId, secret: secretOf(secret), location: { kind: 'DEVICE' }, harness: 'claude-code' }),
    });
    return { shipId, crewToken: z.object({ crewToken: z.string() }).parse(await response.json()).crewToken };
  }

  function send(token: string, input: SendInput): Promise<Response> {
    return fetch(`${address}/api/v1/ship/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
    });
  }

  function toArgo(idempotencyKey: string): SendInput {
    return { selector: { kind: 'ship', name: 'argo' }, payload: idempotencyKey, contentType: 'text/plain', model: 'claude-opus-5-5', idempotencyKey };
  }

  it('answers every send with OK or a busy refusal, and stores nothing for a refused one', { timeout: 120_000 }, async () => {
    const token = await crewToken('busy-sender');
    await slowMessageInserts(database);
    const keys = Array.from({ length: SENDS_AT_ONCE }, () => newKey());

    const answers = await Promise.all(
      keys.map(async (key) => {
        const response = await send(token, toArgo(key));
        return { key, status: response.status, body: z.record(z.string(), z.unknown()).parse(await response.json()) };
      }),
    );

    const stored = new Set(
      (await database.$queryRaw<{ idempotency_key: string }[]>`SELECT idempotency_key FROM messages`).map((row) => row.idempotency_key),
    );
    const sent = answers.filter((answer) => answer.status === 200);
    const refused = answers.filter((answer) => answer.status !== 200);
    expect(sent.length).toBeGreaterThan(0);
    expect(refused.length).toBeGreaterThan(0);
    for (const answer of refused) {
      expect({ status: answer.status, body: answer.body }).toEqual({ status: 503, body: BUSY_REFUSAL });
    }
    expect(refused.filter((answer) => stored.has(answer.key))).toEqual([]);
    expect(sent.filter((answer) => !stored.has(answer.key))).toEqual([]);
  });

  it('refuses a call as busy when it gets no connection to look up its crew token, and stores nothing', { timeout: 120_000 }, async () => {
    const holders = await Promise.all(Array.from({ length: POOL_SIZE }, (_, index) => crewToken(`holder-${index}`)));
    const prober = await crewedShip('prober');
    await slowLookupsExceptFor(database, prober.shipId);
    const held = holders.map((token) =>
      fetch(`${address}/api/v1/ship/whoami`, { headers: { authorization: `Bearer ${token}` } }),
    );
    await untilLookupsHeld(database, POOL_SIZE);
    const key = newKey();

    const response = await send(prober.crewToken, toArgo(key));

    const answer = { status: response.status, body: z.record(z.string(), z.unknown()).parse(await response.json()) };
    const stored = await database.$queryRaw<{ id: string }[]>`SELECT id FROM messages WHERE idempotency_key = ${key}`;
    await Promise.all(held);
    expect({ answer, stored }).toEqual({ answer: { status: 503, body: BUSY_REFUSAL }, stored: [] });
  });
});

// A console call looks up its session before its transaction, in the same
// pool: first the live session it uses, then, when there is none, why the
// session ended. A console call that gets no connection for either in the
// 10 s a call waits is refused as busy, as a ship's call is.

describe('a fleet whose connections are all in use when a console session is looked up', () => {
  let database: PrismaClient;
  let argo: ShipCaller;
  let server: FastifyInstance;
  let address: string;

  beforeAll(async () => {
    const databaseUrl = await createMigratedDatabase();
    database = createPrismaClient(databaseUrl);
    argo = operatorCaller(
      unwrap(await withOperatorLogin(database, createUseCases({ prisma: database }).initialiseFleet({ name: 'home fleet' }))),
    );
    server = createApp({ databaseUrl, publicUrl: FLEET_URL, logger: false });
    address = await server.listen({ host: '127.0.0.1', port: 0 });
  });

  afterAll(async () => {
    await server.close();
    await database.$disconnect();
  });

  /** Crew tokens of ships commissioned by argo and crewed through REST: they will hold the pool's connections. */
  async function holders(prefix: string, count: number): Promise<string[]> {
    return Promise.all(
      Array.from({ length: count }, async (_, index) => {
        const { shipId, secret } = unwrap(
          await createUseCases({ prisma: database }).commissionShip(argo, { idempotencyKey: newKey(), name: `${prefix}-${index}`, type: 'reviewer' }),
        );
        const response = await fetch(`${address}/api/v1/ship/register`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ shipId, secret: secretOf(secret), location: { kind: 'DEVICE' }, harness: 'claude-code' }),
        });
        return z.object({ crewToken: z.string() }).parse(await response.json()).crewToken;
      }),
    );
  }

  /** Each holder's crew-token lookup holds a connection until its trigger lets go. */
  function holdConnections(tokens: string[]): Promise<Response>[] {
    return tokens.map((token) => fetch(`${address}/api/v1/ship/whoami`, { headers: { authorization: `Bearer ${token}` } }));
  }

  /** A console query as the browser makes it, with the session cookie: its answer. */
  async function consoleCall(sessionToken: string): Promise<{ status: number; error: unknown }> {
    const response = await fetch(`${address}/trpc/console.notices`, { headers: { cookie: `aeolus_session=${sessionToken}` } });
    const { error } = z.object({ error: z.object({ message: z.string(), data: z.object({ code: z.string() }) }) }).parse(await response.json());
    return { status: response.status, error: { code: error.data.code, message: error.message } };
  }

  it('refuses a console call as busy when it gets no connection to use its session', { timeout: 120_000 }, async () => {
    const tokens = await holders('live', POOL_SIZE);
    const { token } = unwrap(await createUseCases({ prisma: database }).signIn(OPERATOR));
    await slowLookupsExceptFor(database, argo.shipId);
    const held = holdConnections(tokens);
    await untilLookupsHeld(database, POOL_SIZE);

    const answer = await consoleCall(token);

    await Promise.all(held);
    expect(answer).toEqual({ status: 503, error: BUSY_REFUSAL });
  });

  it('refuses a console call as busy when it gets no connection to learn why its session ended', { timeout: 120_000 }, async () => {
    const tokens = await holders('ended', POOL_SIZE);
    const { token } = unwrap(await createUseCases({ prisma: database }).signIn(OPERATOR));
    await slowLookupsExceptFor(database, argo.shipId);
    let letGo = (): void => undefined;
    let ended = (): void => undefined;
    const sessionEnded = new Promise<void>((resolve) => (ended = resolve));
    // Ends the session in a transaction kept open, so the console call's use
    // of the session waits on its row, holding a connection, until it commits.
    const ending = database.$transaction(
      async (tx) => {
        await tx.$executeRaw`
          UPDATE console_sessions SET ended_at = now(), end_reason = 'takenOver'
          WHERE fleet_id = ${argo.fleetId} AND ended_at IS NULL AND lease_id IS NOT NULL`;
        ended();
        await new Promise<void>((resolve) => (letGo = resolve));
      },
      { timeout: 60_000 },
    );
    await sessionEnded;
    const answering = consoleCall(token);
    await untilSessionUseWaits(database);
    const held = holdConnections(tokens);
    await untilLookupsHeld(database, POOL_SIZE - 1);
    letGo();
    await ending;

    const answer = await answering;

    await Promise.all(held);
    expect(answer).toEqual({ status: 503, error: BUSY_REFUSAL });
  });
});

// The database can be too busy for a send in more ways than a full pool: a
// transaction that runs past its time is rolled back, Postgres can refuse a
// new connection when it holds too many, and a new connection can take longer
// than the 10 s a call waits. Each stores nothing, so each is refused as busy.

/** How long a call's transaction may run before it is rolled back. */
const TRANSACTION_TIME_SECONDS = 5;

/**
 * Stands between a fleet server and Postgres. While it holds, a new
 * connection is accepted but never reaches Postgres, as when Postgres is too
 * loaded to answer; connections made before go on as they are.
 */
async function startConnectionHolder(postgresUrl: string): Promise<{ url: string; hold: () => void; close: () => Promise<void> }> {
  const postgres = new URL(postgresUrl);
  const sockets = new Set<Socket>();
  let isHolding = false;
  const proxy = createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => undefined);
    if (isHolding) {
      return;
    }
    const upstream = connect(Number(postgres.port), postgres.hostname);
    sockets.add(upstream);
    upstream.on('error', () => socket.destroy());
    socket.pipe(upstream).pipe(socket);
  });
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  const address = proxy.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the connection holder has no port');
  }
  const url = new URL(postgresUrl);
  url.hostname = '127.0.0.1';
  url.port = String(address.port);
  return {
    url: url.toString(),
    hold: () => {
      isHolding = true;
    },
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve) => {
        proxy.close(() => {
          resolve();
        });
      });
    },
  };
}

/** Waits until the delivery listener of a fleet server is connected as the given database user. */
async function untilListenerConnected(database: PrismaClient, user: string): Promise<void> {
  for (;;) {
    const [row] = await database.$queryRaw<{ connected: bigint }[]>`
      SELECT count(*) AS connected FROM pg_stat_activity
      WHERE datname = current_database() AND application_name = ${LISTENER_APPLICATION_NAME} AND usename = ${user}`;
    if (row !== undefined && Number(row.connected) >= 1) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe('a fleet whose database is too busy for a send', () => {
  let databaseUrl: string;
  let database: PrismaClient;
  let argo: ShipCaller;
  let server: FastifyInstance;
  let address: string;

  beforeAll(async () => {
    databaseUrl = await createMigratedDatabase();
    database = createPrismaClient(databaseUrl);
    argo = operatorCaller(
      unwrap(await withOperatorLogin(database, createUseCases({ prisma: database }).initialiseFleet({ name: 'home fleet' }))),
    );
    server = createApp({ databaseUrl, publicUrl: FLEET_URL, logger: false });
    address = await server.listen({ host: '127.0.0.1', port: 0 });
  });

  afterAll(async () => {
    await server.close();
    await database.$disconnect();
  });

  /** A ship commissioned by argo and crewed through REST: its crew token. */
  async function crewToken(name: string): Promise<string> {
    const { shipId, secret } = unwrap(
      await createUseCases({ prisma: database }).commissionShip(argo, { idempotencyKey: newKey(), name, type: 'reviewer' }),
    );
    const response = await fetch(`${address}/api/v1/ship/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shipId, secret: secretOf(secret), location: { kind: 'DEVICE' }, harness: 'claude-code' }),
    });
    return z.object({ crewToken: z.string() }).parse(await response.json()).crewToken;
  }

  /** A send to argo through the given fleet server: its answer, and whether its message was stored. */
  async function sendThrough(serverAddress: string, token: string): Promise<{ answer: { status: number; body: unknown }; stored: { id: string }[] }> {
    const key = newKey();
    const response = await fetch(`${serverAddress}/api/v1/ship/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ selector: { kind: 'ship', name: 'argo' }, payload: key, contentType: 'text/plain', model: 'claude-opus-5-5', idempotencyKey: key }),
    });
    const answer = { status: response.status, body: z.record(z.string(), z.unknown()).parse(await response.json()) };
    const stored = await database.$queryRaw<{ id: string }[]>`SELECT id FROM messages WHERE idempotency_key = ${key}`;
    return { answer, stored };
  }

  it('refuses a send as busy when its transaction runs past its time, and stores nothing', { timeout: 60_000 }, async () => {
    const token = await crewToken('slow-sender');
    await database.$executeRawUnsafe(
      `CREATE FUNCTION hold_message_past_time() RETURNS trigger AS $$ BEGIN PERFORM pg_sleep(${TRANSACTION_TIME_SECONDS + 1}); RETURN NEW; END $$ LANGUAGE plpgsql`,
    );
    await database.$executeRawUnsafe(
      'CREATE TRIGGER hold_message_past_time BEFORE INSERT ON messages FOR EACH ROW EXECUTE FUNCTION hold_message_past_time()',
    );

    const sent = await sendThrough(address, token);

    await database.$executeRawUnsafe('DROP TRIGGER hold_message_past_time ON messages');
    expect(sent).toEqual({ answer: { status: 503, body: BUSY_REFUSAL }, stored: [] });
  });

  it('refuses a send as busy when Postgres refuses a connection as one too many, and stores nothing', { timeout: 60_000 }, async () => {
    const token = await crewToken('crowded-sender');
    const owner = new URL(databaseUrl).username;
    const role = `limited_${randomBytes(6).toString('hex')}`;
    const password = randomBytes(12).toString('hex');
    // A member of the owner role reaches every table as the owner does, but
    // is no superuser, so Postgres holds it to its connection limit: one for
    // the delivery listener and one more.
    // The role and password are generated above, never outside input.
    await database.$executeRawUnsafe(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' CONNECTION LIMIT 2 IN ROLE "${owner}"`);
    const limitedUrl = new URL(databaseUrl);
    limitedUrl.username = role;
    limitedUrl.password = password;
    const crowded = createApp({ databaseUrl: limitedUrl.toString(), publicUrl: FLEET_URL, logger: false });
    const crowdedAddress = await crowded.listen({ host: '127.0.0.1', port: 0 });
    await untilListenerConnected(database, role);
    // Its one query leaves the role's last connection open, idle in its pool.
    const lastConnection = createPrismaClient(limitedUrl.toString());
    await lastConnection.$queryRaw`SELECT 1`;

    const sent = await sendThrough(crowdedAddress, token);

    await lastConnection.$disconnect();
    await crowded.close();
    expect(sent).toEqual({ answer: { status: 503, body: BUSY_REFUSAL }, stored: [] });
  });

  it('refuses a send as busy when a new connection is not made within 10 s, and stores nothing', { timeout: 60_000 }, async () => {
    const token = await crewToken('stalled-sender');
    const holder = await startConnectionHolder(databaseUrl);
    const stalled = createApp({ databaseUrl: holder.url, publicUrl: FLEET_URL, logger: false });
    const stalledAddress = await stalled.listen({ host: '127.0.0.1', port: 0 });
    await untilListenerConnected(database, new URL(databaseUrl).username);
    holder.hold();

    const sent = await sendThrough(stalledAddress, token);

    await holder.close();
    await stalled.close();
    expect(sent).toEqual({ answer: { status: 503, body: BUSY_REFUSAL }, stored: [] });
  });
});
