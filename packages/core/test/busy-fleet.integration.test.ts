import type { SendInput } from '@aeolus-fleet/common';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createApp } from '../src/app.js';
import type { Caller } from '../src/domain/shared/caller.js';
import { createUseCases } from '../src/wiring.js';
import { FLEET_URL, OPERATOR, operatorCaller, secretOf } from './support/core-fixtures.js';
import { createMigratedDatabase } from './support/database.js';
import { newKey } from './support/keys.js';
import { unwrap } from './support/result.js';

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
  let argo: Caller;
  let server: FastifyInstance;
  let address: string;

  beforeAll(async () => {
    const databaseUrl = await createMigratedDatabase();
    database = createPrismaClient(databaseUrl);
    argo = operatorCaller(
      unwrap(await createUseCases({ prisma: database }).initialiseFleet({ name: 'home fleet', ...OPERATOR })),
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
  let argo: Caller;
  let server: FastifyInstance;
  let address: string;

  beforeAll(async () => {
    const databaseUrl = await createMigratedDatabase();
    database = createPrismaClient(databaseUrl);
    argo = operatorCaller(
      unwrap(await createUseCases({ prisma: database }).initialiseFleet({ name: 'home fleet', ...OPERATOR })),
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
