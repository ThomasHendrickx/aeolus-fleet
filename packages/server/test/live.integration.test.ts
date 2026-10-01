import { fleetStreamItemSchema, type FleetStreamItem, type ShipId } from '@aeolus-fleet/common';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { z } from 'zod';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { LISTENER_APPLICATION_NAME } from '../src/adapters/prisma/delivery-notices.js';
import { createApp } from '../src/app.js';
import type { Caller } from '../src/core/shared/caller.js';
import { createUseCases, type UseCases } from '../src/wiring.js';
import { FLEET_URL, OPERATOR, operatorCaller, secretIn } from './support/core-fixtures.js';
import { createMigratedDatabase } from './support/database.js';
import { createTestClock } from './support/postgres-core.js';
import { unwrap } from './support/result.js';

// The live fleet view's subscription over a WebSocket, from Postgres to the
// browser: each committed event arrives with its number in commit order, a
// browser that comes back with the number it reached gets every event after
// it, and the subscription is the console session's: from the console's
// origin only, and over once the session ends.

const clock = createTestClock('2026-10-01T09:00:00.000Z');
/** Where the console runs: the fleet's own origin, as no other console origin is configured. */
const CONSOLE = new URL(FLEET_URL).origin;
/** Sign-ins are not what these tests count. */
const SIGN_IN_RATE_LIMIT = { limit: 1000, windowMs: 60_000 };

let databaseUrl: string;
let database: PrismaClient;
let server: FastifyInstance;
let address: string;
let useCases: UseCases;
let argo: Caller;
const browsers: WebSocket[] = [];

beforeAll(async () => {
  databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  useCases = createUseCases({ prisma: database, clock, fleetUrl: FLEET_URL });
  argo = operatorCaller(unwrap(await useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR })));
  server = createApp({ databaseUrl, publicUrl: FLEET_URL, clock, logger: false, signInRateLimit: SIGN_IN_RATE_LIMIT });
  address = await server.listen({ host: '127.0.0.1', port: 0 });
});

afterEach(() => {
  for (const browser of browsers.splice(0)) {
    browser.close();
  }
});

afterAll(async () => {
  await server.close();
  await database.$disconnect();
});

/** The session cookie of a new console session. */
async function signIn(): Promise<string> {
  const response = await fetch(`${address}/trpc/console.signIn`, {
    method: 'POST',
    headers: { origin: CONSOLE, 'content-type': 'application/json' },
    body: JSON.stringify(OPERATOR),
  });
  const [cookie] = response.headers.getSetCookie();
  return cookie?.split(';')[0] ?? '';
}

const answerSchema = z.object({
  id: z.number(),
  result: z.object({ type: z.string(), id: z.string().optional(), data: z.unknown().optional() }).optional(),
  error: z.object({ data: z.object({ code: z.string() }) }).optional(),
});

const trackedSchema = z.object({ id: z.string(), data: z.unknown() });

interface Following {
  /** What the subscription sent, with the event id tRPC tracks it by. */
  items: { trackedId: string; item: FleetStreamItem }[];
  /** The tRPC code the subscription ended with, if it did. */
  refusal?: string;
}

/**
 * A browser following the fleet as the console's wsLink does: one socket to
 * /trpc, one subscription to fleet.events, from the console's origin unless
 * told another.
 */
async function follow(options: { cookie?: string; origin?: string; lastEventId?: string }): Promise<Following> {
  const following: Following = { items: [] };
  const headers: Record<string, string> = { origin: options.origin ?? CONSOLE };
  if (options.cookie !== undefined) {
    headers.cookie = options.cookie;
  }
  const socket = new WebSocket(`${address.replace(/^http/, 'ws')}/trpc`, { headers });
  browsers.push(socket);
  socket.on('message', (raw: Buffer) => {
    const answer = answerSchema.parse(JSON.parse(raw.toString()));
    if (answer.error) {
      following.refusal = answer.error.data.code;
    } else if (answer.result?.type === 'data') {
      // A tracked item travels as { id, data }; its id is the event's number.
      const { id, data } = trackedSchema.parse(answer.result.data);
      following.items.push({ trackedId: id, item: fleetStreamItemSchema.parse(data) });
    }
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => {
      resolve();
    });
    socket.once('error', reject);
  });
  socket.send(
    JSON.stringify({
      id: 1,
      method: 'subscription',
      params: { path: 'fleet.events', input: { lastEventId: options.lastEventId ?? null } },
    }),
  );
  return following;
}

/** The event types heard so far, in order; `resync` for the word to load the fleet again. */
function heard(following: Following): string[] {
  return following.items.map(({ item }) => (item.kind === 'event' ? item.event.type : 'resync'));
}

/** The number of the last event heard. */
function lastSeq(following: Following): number {
  return Number(following.items.at(-1)?.trackedId);
}

async function commissionScout(name: string): Promise<{ shipId: ShipId; secret: string }> {
  const { shipId, prompt } = unwrap(await useCases.commissionShip(argo, { name, type: 'reviewer' }));
  return { shipId, secret: secretIn(prompt) };
}

describe('following the fleet live', () => {
  it('tells a browser without a position to load the fleet, at the last number', async () => {
    const following = await follow({ cookie: await signIn() });

    await expect.poll(() => heard(following)).toEqual(['resync']);
    expect(lastSeq(following)).toBe(Number((await database.fleet.findFirstOrThrow()).lastEventSeq));
  });

  it('sends a ship commissioned, claimed and released as each commits, numbered one after another', async () => {
    const following = await follow({ cookie: await signIn() });
    await expect.poll(() => heard(following)).toEqual(['resync']);
    const start = lastSeq(following);

    const { shipId, secret } = await commissionScout('scout');
    unwrap(await useCases.claimShip({ shipId, secret, location: { kind: 'DEVICE' } }));
    unwrap(await useCases.releaseShip(argo, { shipId }));

    await expect.poll(() => heard(following)).toEqual([
      'resync',
      'ShipCommissioned',
      'StartingPromptIssued',
      'ShipClaimed',
      'CredentialRevoked',
      'LeaseRevoked',
    ]);
    expect(following.items.slice(1).map(({ trackedId }) => Number(trackedId))).toEqual([
      start + 1,
      start + 2,
      start + 3,
      start + 4,
      start + 5,
    ]);
    expect(following.items[1]?.item).toMatchObject({
      kind: 'event',
      event: { seq: start + 1, type: 'ShipCommissioned', shipId },
    });
  });

  it('gives a browser coming back with its number every event committed while it was away, then follows', async () => {
    const cookie = await signIn();
    const away = await follow({ cookie });
    await expect.poll(() => heard(away)).toEqual(['resync']);
    const reached = lastSeq(away);
    browsers.splice(0).forEach((socket) => {
      socket.close();
    });

    await commissionScout('lookout');
    const back = await follow({ cookie, lastEventId: String(reached) });
    await expect.poll(() => heard(back)).toEqual(['ShipCommissioned', 'StartingPromptIssued']);
    await commissionScout('pilot');

    await expect.poll(() => heard(back)).toEqual([
      'ShipCommissioned',
      'StartingPromptIssued',
      'ShipCommissioned',
      'StartingPromptIssued',
    ]);
    expect(Number(back.items[0]?.trackedId)).toBe(reached + 1);
  });

  it('still sends an event committed while the listener had lost its connection, once it listens again', async () => {
    const following = await follow({ cookie: await signIn() });
    await expect.poll(() => heard(following)).toEqual(['resync']);

    const listeners = await database.$queryRaw<{ pid: number }[]>`
      SELECT pid FROM pg_stat_activity
      WHERE application_name = ${LISTENER_APPLICATION_NAME} AND datname = current_database()`;
    for (const { pid } of listeners) {
      await database.$queryRaw`SELECT pg_terminate_backend(${pid})`;
    }
    await commissionScout('helmsman');

    await expect.poll(() => heard(following), { timeout: 10_000 }).toEqual(['resync', 'ShipCommissioned', 'StartingPromptIssued']);
  });

  it('refuses a browser that is not signed in', async () => {
    const following = await follow({});

    await expect.poll(() => following.refusal).toBe('UNAUTHORIZED');
    expect(following.items).toEqual([]);
  });

  it("refuses a page on another origin, even with the operator's cookie", async () => {
    const following = await follow({ cookie: await signIn(), origin: 'https://elsewhere.example.com' });

    await expect.poll(() => following.refusal).toBe('FORBIDDEN');
    expect(following.items).toEqual([]);
  });

  it('ends when the operator signs in somewhere else', async () => {
    const following = await follow({ cookie: await signIn() });
    await expect.poll(() => heard(following)).toEqual(['resync']);

    await signIn();

    await expect.poll(() => following.refusal).toBe('UNAUTHORIZED');
  });
});
