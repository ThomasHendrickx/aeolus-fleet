import type { ShipId } from '@aeolus-fleet/common';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createApp } from '../src/app.js';
import type { Caller } from '../src/core/shared/caller.js';
import { createUseCases } from '../src/wiring.js';
import { FLEET_URL, OPERATOR, operatorCaller, secretIn } from './support/core-fixtures.js';
import { createMigratedDatabase } from './support/database.js';
import { unwrap } from './support/result.js';

// The ship contract as REST under /api/v1, from plain HTTP requests (as curl
// makes them) to Postgres and back: register with the ship's id and secret,
// then every call with the crew token as a bearer.

/** How long a receive waits on an empty inbox at this server: short, so an empty receive costs little. */
const RECEIVE_WAIT_MS = 500;

let databaseUrl: string;
let database: PrismaClient;
let argo: Caller;
let server: FastifyInstance;
let address: string;
let shipCount = 0;
let keyCount = 0;

beforeAll(async () => {
  databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  argo = operatorCaller(
    unwrap(await createUseCases({ prisma: database, fleetUrl: FLEET_URL }).initialiseFleet({ name: 'home fleet', ...OPERATOR })),
  );
  server = createApp({ databaseUrl, publicUrl: FLEET_URL, logger: false, receiveWaitMs: RECEIVE_WAIT_MS });
  address = await server.listen({ host: '127.0.0.1', port: 0 });
});

afterAll(async () => {
  await server.close();
  await database.$disconnect();
});

/** A new agent ship, commissioned by argo: its id, name and the secret its starting prompt holds. */
async function commissioned(): Promise<{ shipId: ShipId; name: string; secret: string }> {
  shipCount += 1;
  const name = `rest-ship-${shipCount}`;
  const { shipId, prompt } = unwrap(
    await createUseCases({ prisma: database, fleetUrl: FLEET_URL }).commissionShip(argo, { name, type: 'reviewer' }),
  );
  return { shipId, name, secret: secretIn(prompt) };
}

/** A new ship commissioned by argo with fleet scopes, claimed with its secret: its name and crew token. */
async function crewedWithFleetScopes(fleetScopes: ('fleet:read' | 'fleet:manage')[]): Promise<{ name: string; crewToken: string }> {
  shipCount += 1;
  const name = `rest-manager-${shipCount}`;
  const { shipId, prompt } = unwrap(
    await createUseCases({ prisma: database, fleetUrl: FLEET_URL }).commissionShip(argo, { name, type: 'squadron', fleetScopes }),
  );
  return { name, crewToken: await register({ shipId, secret: secretIn(prompt) }) };
}

/** A new idempotency key: every message gets its own. */
function freshKey(): string {
  keyCount += 1;
  return `key-${keyCount}`;
}

/** A request as curl makes it: a JSON body when there is one, the crew token as a bearer when there is one. */
async function request(
  call: string,
  options: { crewToken?: string; body?: unknown; method?: 'GET' | 'POST' } = {},
): Promise<{ status: number; body: unknown }> {
  const { crewToken, body, method = 'POST' } = options;
  const headers: Record<string, string> = {};
  if (crewToken !== undefined) {
    headers.authorization = `Bearer ${crewToken}`;
  }
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  // A fleet action is named with its route (fleet/list); a ship call by its name alone.
  const response = await fetch(`${address}/api/v1/${call.startsWith('fleet/') ? call : `ship/${call}`}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

/** The answer of a call that must succeed, parsed. */
async function ok<T>(answer: Promise<{ status: number; body: unknown }>, schema: z.ZodType<T>): Promise<T> {
  const { status, body } = await answer;
  expect(status, JSON.stringify(body)).toBe(200);
  return schema.parse(body);
}

async function register(ship: { shipId: ShipId; secret: string }): Promise<string> {
  const { crewToken } = await ok(
    request('register', { body: { shipId: ship.shipId, secret: ship.secret, location: { kind: 'SERVER' } } }),
    z.object({ crewToken: z.string() }),
  );
  return crewToken;
}

const deliveriesSchema = z.object({
  deliveries: z.array(
    z.object({
      deliveryId: z.string(),
      messageId: z.string(),
      senderShipId: z.string(),
      senderName: z.string(),
      payload: z.string(),
      inReplyTo: z.string().nullable(),
    }),
  ),
});

describe('the ship calls at /api/v1', () => {
  it('serve an OpenAPI spec that lists every ship procedure, then the fleet actions', async () => {
    const response = await fetch(`${address}/api/v1/openapi.json`);

    const { paths } = z.object({ paths: z.record(z.string(), z.unknown()) }).parse(await response.json());
    expect(response.status).toBe(200);
    expect(Object.keys(paths)).toEqual([
      '/ship/register',
      '/ship/whoami',
      '/ship/send',
      '/ship/receive',
      '/ship/ack',
      '/ship/pong',
      '/ship/inbox',
      '/ship/deregister',
      '/fleet/list',
      '/fleet/ship',
      '/fleet/commission',
      '/fleet/getStartingPrompt',
      '/fleet/release',
      '/fleet/recrew',
      '/fleet/retire',
      '/fleet/ping',
      '/fleet/follow',
    ]);
  });

  it('check the inbox: how many deliveries wait for the crew, claiming none of them', async () => {
    const harbour = await commissioned();
    const mooring = await commissioned();
    const harbourToken = await register(harbour);
    const mooringToken = await register(mooring);
    await ok(request('inbox', { crewToken: mooringToken }), z.object({ waiting: z.literal(0) }));

    await ok(
      request('send', {
        crewToken: harbourToken,
        body: { selector: { kind: 'ship', name: mooring.name }, payload: 'Moor at berth 4', idempotencyKey: freshKey() },
      }),
      z.object({ messageId: z.string() }),
    );

    await expect(ok(request('inbox', { crewToken: mooringToken, body: { waitSeconds: 1 } }), z.object({ waiting: z.number() }))).resolves.toEqual({
      waiting: 1,
    });
    const received = await ok(request('receive', { crewToken: mooringToken }), deliveriesSchema);
    expect(received.deliveries).toHaveLength(1);
  });

  it('register, send, receive, ack and deregister: two ships exchange a message and its answer', async () => {
    const harbour = await commissioned();
    const mooring = await commissioned();
    const harbourToken = await register(harbour);
    const mooringToken = await register(mooring);

    const whoami = await ok(request('whoami', { crewToken: mooringToken, method: 'GET' }), z.object({ name: z.string() }));
    const { messageId } = await ok(
      request('send', {
        crewToken: harbourToken,
        body: { selector: { kind: 'ship', name: mooring.name }, payload: 'Moor at berth 4', idempotencyKey: freshKey() },
      }),
      z.object({ messageId: z.string() }),
    );
    const received = await ok(request('receive', { crewToken: mooringToken, body: { max: 10 } }), deliveriesSchema);
    const [delivery] = received.deliveries;
    await ok(request('ack', { crewToken: mooringToken, body: { deliveryId: delivery?.deliveryId } }), z.strictObject({}));
    const { messageId: answerId } = await ok(
      request('send', {
        crewToken: mooringToken,
        body: {
          selector: { kind: 'ship', name: delivery?.senderName },
          payload: 'Moored',
          idempotencyKey: freshKey(),
          inReplyTo: delivery?.messageId,
        },
      }),
      z.object({ messageId: z.string() }),
    );
    const answered = await ok(request('receive', { crewToken: harbourToken }), deliveriesSchema);
    const [answer] = answered.deliveries;
    await ok(request('ack', { crewToken: harbourToken, body: { deliveryId: answer?.deliveryId } }), z.strictObject({}));
    await ok(request('deregister', { crewToken: mooringToken }), z.strictObject({}));

    expect(whoami.name).toBe(mooring.name);
    expect(delivery).toMatchObject({ messageId, senderShipId: harbour.shipId, senderName: harbour.name });
    expect(answer).toMatchObject({ messageId: answerId, senderName: mooring.name, inReplyTo: messageId });
    await expect(ok(request('receive', { crewToken: harbourToken }), deliveriesSchema)).resolves.toEqual({ deliveries: [] });
    await expect(request('whoami', { crewToken: mooringToken, method: 'GET' })).resolves.toMatchObject({
      status: 401,
      body: { code: 'LEASE_ENDED', message: 'This ship was released; this session no longer crews it.' },
    });
  });

  it('pong: a ship answers the ping argo sent it, and the ping is acknowledged', async () => {
    const skiff = await commissioned();
    const crewToken = await register(skiff);
    const { messageId } = unwrap(
      await createUseCases({ prisma: database, fleetUrl: FLEET_URL }).pingShip(argo, { shipId: skiff.shipId }),
    );
    const { deliveries } = await ok(request('receive', { crewToken }), deliveriesSchema);
    const [ping] = deliveries;

    await ok(request('pong', { crewToken, body: { deliveryId: ping?.deliveryId } }), z.strictObject({}));

    expect(ping).toMatchObject({ messageId });
    await expect(database.delivery.findFirstOrThrow({ where: { messageId } })).resolves.toMatchObject({
      state: 'acknowledged',
    });
  });

  it('refuse a second register of a ship a session crews with 409, its code and its message', async () => {
    const scout = await commissioned();
    await register(scout);

    const second = await request('register', {
      body: { shipId: scout.shipId, secret: scout.secret, location: { kind: 'CLOUD' } },
    });

    expect(second).toEqual({
      status: 409,
      body: { code: 'CONFLICT', message: `${scout.name} is crewed: a session claims a ship only while it awaits crew` },
    });
  });

  it('refuse a call without a crew token, or with one that is not valid, with 401', async () => {
    const scout = await commissioned();
    const scoutToken = await register(scout);
    const sending = { selector: { kind: 'ship', name: scout.name }, payload: 'Anyone aboard?', idempotencyKey: freshKey() };
    const messagesBefore = await database.message.count();

    const refused = { status: 401, body: { code: 'UNAUTHORIZED', message: 'Call with the crew token register gave you' } };
    await expect(request('send', { body: sending })).resolves.toEqual(refused);
    await expect(request('send', { crewToken: 'aeolus_ct_v1_not-a-crew', body: sending })).resolves.toEqual(refused);
    await expect(request('receive', { crewToken: scout.secret })).resolves.toMatchObject({ status: 401 });
    await expect(database.message.count()).resolves.toBe(messagesBefore);
    await expect(request('whoami', { crewToken: scoutToken, method: 'GET' })).resolves.toMatchObject({ status: 200 });
  });
});

describe('the fleet actions at /api/v1/fleet', () => {
  it('let a ship with fleet:read and fleet:manage list the fleet, commission a ship and ping a crewed one', async () => {
    const manager = await crewedWithFleetScopes(['fleet:read', 'fleet:manage']);
    const mooring = await commissioned();
    await register(mooring);

    const listed = await ok(request('fleet/list', { crewToken: manager.crewToken, method: 'GET' }), z.array(z.object({ name: z.string() })));
    const commissionedByManager = await ok(
      request('fleet/commission', { crewToken: manager.crewToken, body: { name: `${manager.name}-member`, type: 'squadron' } }),
      z.object({ shipId: z.string(), prompt: z.string() }),
    );
    const pinged = await ok(
      request('fleet/ping', { crewToken: manager.crewToken, body: { shipId: mooring.shipId } }),
      z.object({ messageId: z.string(), isNew: z.boolean() }),
    );

    expect(listed.map((ship) => ship.name)).toEqual(expect.arrayContaining([manager.name, mooring.name]));
    expect(commissionedByManager.prompt).toContain(`Ship id: ${commissionedByManager.shipId}`);
    expect(pinged.isNew).toBe(true);
  });

  it('follow the fleet: the current number without a position, then the events after it', async () => {
    const reader = await crewedWithFleetScopes(['fleet:read']);
    const followed = z.object({ events: z.array(z.object({ seq: z.number(), type: z.string() })), lastSeq: z.number() });
    const { lastSeq } = await ok(request('fleet/follow', { crewToken: reader.crewToken, body: {} }), followed);
    await commissioned();

    const { events } = await ok(request('fleet/follow', { crewToken: reader.crewToken, body: { afterSeq: lastSeq } }), followed);

    expect(events.map((event) => event.type)).toEqual(['ShipCommissioned', 'StartingPromptIssued']);
  });

  it('refuse the fleet list with 403 to a ship without fleet:read', async () => {
    const agent = await commissioned();
    const crewToken = await register(agent);

    await expect(request('fleet/list', { crewToken, method: 'GET' })).resolves.toEqual({
      status: 403,
      body: { code: 'FORBIDDEN', message: 'This call needs the fleet:read scope' },
    });
  });
});

describe('the API reference page', () => {
  it('is served at /api/v1/docs, as HTML', async () => {
    const response = await fetch(`${address}/api/v1/docs`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^text\/html/);
  });
});
