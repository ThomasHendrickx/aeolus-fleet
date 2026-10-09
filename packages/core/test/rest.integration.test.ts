import type { FleetScope, ShipId } from '@aeolus-fleet/common';
import { reportLogOutputSchema } from '@aeolus-fleet/common';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { SHIP_CALLS } from '../src/adapters/trpc/ship-contract.js';
import { createApp } from '../src/app.js';
import type { Caller } from '../src/domain/shared/caller.js';
import { createUseCases } from '../src/wiring.js';
import { FLEET_URL, OPERATOR, operatorCaller, secretOf } from './support/core-fixtures.js';
import { createMigratedDatabase } from './support/database.js';
import { unwrap } from './support/result.js';
import { newKey } from './support/keys.js';

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
    unwrap(await createUseCases({ prisma: database }).initialiseFleet({ name: 'home fleet', ...OPERATOR })),
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
  const { shipId, secret } = unwrap(
    await createUseCases({ prisma: database }).commissionShip(argo, { idempotencyKey: newKey(), name, type: 'reviewer' }),
  );
  return { shipId, name, secret: secretOf(secret) };
}

/** A new ship commissioned by argo with fleet scopes, claimed with its secret: its name and crew token. */
async function crewedWithFleetScopes(fleetScopes: FleetScope[]): Promise<{ name: string; shipId: ShipId; crewToken: string }> {
  shipCount += 1;
  const name = `rest-manager-${shipCount}`;
  const { shipId, secret } = unwrap(
    await createUseCases({ prisma: database }).commissionShip(argo, { idempotencyKey: newKey(), name, type: 'squadron', fleetScopes }),
  );
  return { name, shipId, crewToken: await register({ shipId, secret: secretOf(secret) }) };
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
    request('register', { body: { shipId: ship.shipId, secret: ship.secret, location: { kind: 'SERVER' }, harness: 'claude-code' } }),
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
      '/ship/report',
      '/ship/reportLog',
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
      '/fleet/crewRequest',
      '/fleet/removeCrewRequest',
      '/fleet/assignCrew',
      '/fleet/explainCrewRequest',
      '/fleet/reportCrewStatus',
      '/fleet/confirmCrewRelease',
      '/fleet/giveBackCrewRequest',
      '/fleet/assignedCrewRequests',
      '/fleet/clearWorktree',
      '/fleet/clearRequests',
      '/fleet/confirmWorktreeCleared',
      '/fleet/labels',
      '/fleet/defineLabel',
      '/fleet/changeLabelValues',
      '/fleet/assignLabel',
      '/fleet/unassignLabel',
      '/fleet/deleteLabel',
      '/fleet/findLabelValue',
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
        body: { selector: { kind: 'ship', name: mooring.name }, payload: 'Moor at berth 4', model: 'claude-opus-5-5', idempotencyKey: freshKey() },
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
        body: { selector: { kind: 'ship', name: mooring.name }, payload: 'Moor at berth 4', model: 'claude-opus-5-5', idempotencyKey: freshKey() },
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
          model: 'claude-opus-5-5',
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
      await createUseCases({ prisma: database }).pingShip(argo, { shipId: skiff.shipId }),
    );
    const { deliveries } = await ok(request('receive', { crewToken }), deliveriesSchema);
    const [ping] = deliveries;

    await ok(request('pong', { crewToken, body: { deliveryId: ping?.deliveryId } }), z.strictObject({}));

    expect(ping).toMatchObject({ messageId });
    await expect(database.delivery.findFirstOrThrow({ where: { messageId } })).resolves.toMatchObject({
      state: 'acknowledged',
    });
  });

  it('report: a crew says it is working and on what, shown with its ship', async () => {
    const skiff = await commissioned();
    const crewToken = await register(skiff);

    await ok(request('report', { crewToken, body: { state: 'working', note: 'on PR 89' } }), z.strictObject({}));

    const listed = await createUseCases({ prisma: database }).listFleet(argo);
    expect(listed.find((ship) => ship.id === skiff.shipId)?.report).toMatchObject({ state: 'working', note: 'on PR 89' });
  });

  it('report and reportLog: a crew sets its details, patches them, and reads them back with their version', async () => {
    const skiff = await commissioned();
    const crewToken = await register(skiff);

    await ok(request('report', { crewToken, body: { state: 'working', details: { 'shp_01': { state: 'running' }, kept: ['a'] } } }), z.strictObject({}));
    await ok(request('report', { crewToken, body: { state: 'working', detailsPatch: { kept: null } } }), z.strictObject({}));

    await expect(ok(request('reportLog', { crewToken, method: 'GET' }), reportLogOutputSchema)).resolves.toMatchObject({
      report: { state: 'working', details: { 'shp_01': { state: 'running' } }, detailsVersion: 2 },
      previousCrew: null,
    });
  });

  it('refuse report details over 16 KB with 400, naming their size, the limit and the decision', async () => {
    const skiff = await commissioned();
    const crewToken = await register(skiff);

    const answer = await request('report', { crewToken, body: { state: 'working', details: { x: 'x'.repeat(16 * 1024) } } });

    expect(answer).toEqual({
      status: 400,
      body: { code: 'BAD_REQUEST', message: 'details is 16392 bytes, the limit is 16384 (decision 0028)' },
    });
  });

  it('refuse a second register of a ship a session crews with 409, its code and its message', async () => {
    const scout = await commissioned();
    await register(scout);

    const second = await request('register', {
      body: { shipId: scout.shipId, secret: scout.secret, location: { kind: 'CLOUD' }, harness: 'claude-code' },
    });

    expect(second).toEqual({
      status: 409,
      body: { code: 'CONFLICT', message: `${scout.name} is crewed: a session claims a ship only while it awaits crew` },
    });
  });

  it('refuse a call without a crew token, or with one that is not valid, with 401', async () => {
    const scout = await commissioned();
    const scoutToken = await register(scout);
    const sending = { selector: { kind: 'ship', name: scout.name }, payload: 'Anyone aboard?', model: 'claude-opus-5-5', idempotencyKey: freshKey() };
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

    const listed = await ok(request('fleet/list', { crewToken: manager.crewToken, method: 'POST' }), z.array(z.object({ name: z.string() })));
    const commission = { name: `${manager.name}-member`, type: 'squadron', idempotencyKey: 'commission-member' };
    const commissionedByManager = await ok(
      request('fleet/commission', { crewToken: manager.crewToken, body: commission }),
      z.object({ shipId: z.string(), prompt: z.string() }),
    );
    const repeated = await ok(
      request('fleet/commission', { crewToken: manager.crewToken, body: commission }),
      z.object({ shipId: z.string(), prompt: z.null(), crewLines: z.null(), secret: z.null(), startingPrompt: z.object({ isClaimed: z.boolean() }) }),
    );
    const pinged = await ok(
      request('fleet/ping', { crewToken: manager.crewToken, body: { shipId: mooring.shipId } }),
      z.object({ messageId: z.string(), isNew: z.boolean() }),
    );

    expect(listed.map((ship) => ship.name)).toEqual(expect.arrayContaining([manager.name, mooring.name]));
    expect(commissionedByManager.prompt).toContain(`Ship id: ${commissionedByManager.shipId}`);
    expect(repeated).toMatchObject({ shipId: commissionedByManager.shipId, startingPrompt: { isClaimed: false } });
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

  it('serve a ship with fleet:manage a crew request: requested, replaced, read with the ship, and removed', async () => {
    const manager = await crewedWithFleetScopes(['fleet:read', 'fleet:manage']);
    const scout = await commissioned();

    await ok(request('fleet/crewRequest', { crewToken: manager.crewToken, body: { shipId: scout.shipId, settings: { harness: 'claude-code' } } }), z.object({ settingsVersion: z.literal(1) }));
    await ok(request('fleet/crewRequest', { crewToken: manager.crewToken, body: { shipId: scout.shipId, settings: { harness: 'codex' } } }), z.object({ settingsVersion: z.literal(2) }));
    const ship = await ok(request('fleet/ship', { crewToken: manager.crewToken, body: { shipId: scout.shipId } }), z.object({ crewRequest: z.unknown() }));
    await ok(request('fleet/removeCrewRequest', { crewToken: manager.crewToken, body: { shipId: scout.shipId } }), z.strictObject({}));

    expect(ship.crewRequest).toMatchObject({ settings: { harness: 'codex' }, settingsVersion: 2 });
    await expect(request('fleet/removeCrewRequest', { crewToken: manager.crewToken, body: { shipId: scout.shipId } })).resolves.toMatchObject({
      status: 404,
      body: { code: 'NOT_FOUND' },
    });
  });

  it('refuse a crew request to a ship without fleet:manage', async () => {
    const reader = await crewedWithFleetScopes(['fleet:read']);
    const scout = await commissioned();

    await expect(request('fleet/crewRequest', { crewToken: reader.crewToken, body: { shipId: scout.shipId, settings: {} } })).resolves.toMatchObject({
      status: 403,
      body: { code: 'FORBIDDEN' },
    });
  });

  it('refuse every fleet route but its own with 403 to a ship with only crew:run', async () => {
    const trierarch = await crewedWithFleetScopes(['crew:run']);
    const others = SHIP_CALLS.filter(
      (each) => each.route.startsWith('/fleet/') && !['/fleet/ship', '/fleet/getStartingPrompt', '/fleet/release', '/fleet/reportCrewStatus', '/fleet/confirmCrewRelease', '/fleet/giveBackCrewRequest', '/fleet/assignedCrewRequests', '/fleet/clearRequests', '/fleet/confirmWorktreeCleared'].includes(each.route),
    );

    const answers = await Promise.all(
      others.map(async (each) => {
        const answer = await request(each.route.slice(1), { crewToken: trierarch.crewToken, method: each.method, ...(each.method === 'POST' && { body: {} }) });
        return [each.route, answer.status];
      }),
    );

    expect(others.length).toBeGreaterThan(0);
    expect(Object.fromEntries(answers)).toEqual(Object.fromEntries(others.map((each) => [each.route, 403])));
  });

  it('serve the plugin with crew:assign and the trierarch with crew:run a crew request: assigned, read, run, released and confirmed', async () => {
    const plugin = await crewedWithFleetScopes(['crew:assign']);
    const trierarch = await crewedWithFleetScopes(['crew:run']);
    const trierarchId = trierarch.shipId;
    const scout = await commissioned();
    unwrap(await createUseCases({ prisma: database }).requestCrew(argo, { shipId: scout.shipId, settings: { harness: 'codex' } }));

    await ok(request('fleet/assignCrew', { crewToken: plugin.crewToken, body: { shipId: scout.shipId, trierarchShipId: trierarchId } }), z.strictObject({}));
    const assigned = await ok(
      request('fleet/assignedCrewRequests', { crewToken: trierarch.crewToken, method: 'GET' }),
      z.array(z.object({ shipId: z.string(), settings: z.unknown(), settingsVersion: z.number(), requestedAt: z.iso.datetime(), status: z.unknown() })),
    );
    const read = await ok(request('fleet/ship', { crewToken: trierarch.crewToken, body: { shipId: scout.shipId } }), z.object({ id: z.string() }));
    await ok(request('fleet/getStartingPrompt', { crewToken: trierarch.crewToken, body: { shipId: scout.shipId } }), z.object({ secret: z.string() }));
    await ok(request('fleet/reportCrewStatus', { crewToken: trierarch.crewToken, body: { shipId: scout.shipId, status: 'running' } }), z.strictObject({}));
    unwrap(await createUseCases({ prisma: database }).removeCrewRequest(argo, { shipId: scout.shipId }));
    await ok(request('fleet/confirmCrewRelease', { crewToken: trierarch.crewToken, body: { shipId: scout.shipId } }), z.strictObject({}));

    expect(assigned).toMatchObject([{ shipId: scout.shipId, settings: { harness: 'codex' }, settingsVersion: 1, status: null }]);
    expect(assigned).toHaveLength(1);
    expect(read.id).toBe(scout.shipId);
    await expect(database.crewRequest.count({ where: { shipId: scout.shipId } })).resolves.toBe(0);
  });

  it('serve a clear request: asked with fleet:manage, read with fleet:read and by its trierarch, confirmed by it (decision 0032)', async () => {
    const manager = await crewedWithFleetScopes(['fleet:read', 'fleet:manage']);
    shipCount += 1;
    const machine = unwrap(
      await createUseCases({ prisma: database }).commissionShip(argo, { idempotencyKey: newKey(), name: `rest-trierarch-${shipCount}`, type: 'trierarch', fleetScopes: ['crew:run'] }),
    );
    const trierarchToken = await register({ shipId: machine.shipId, secret: secretOf(machine.secret) });
    const scout = await commissioned();
    const worktree = { shipId: scout.shipId, repository: 'aeolus-fleet' };
    const listed = z.array(z.object({ trierarchShipId: z.string(), shipId: z.string(), repository: z.string(), requestedBy: z.string(), requestedAt: z.iso.datetime() }));

    await ok(request('fleet/clearWorktree', { crewToken: manager.crewToken, body: { trierarchShipId: machine.shipId, ...worktree } }), z.strictObject({}));
    const read = await ok(request('fleet/clearRequests', { crewToken: manager.crewToken, method: 'GET' }), listed);
    const own = await ok(request('fleet/clearRequests', { crewToken: trierarchToken, method: 'GET' }), listed);
    await ok(request('fleet/confirmWorktreeCleared', { crewToken: trierarchToken, body: { ...worktree, outcome: 'not-kept' } }), z.strictObject({}));

    expect(read).toContainEqual(expect.objectContaining({ trierarchShipId: machine.shipId, ...worktree, requestedBy: manager.shipId }));
    expect(own).toEqual([expect.objectContaining({ trierarchShipId: machine.shipId, ...worktree })]);
    await expect(database.worktreeClearRequest.count({ where: { trierarchShipId: machine.shipId } })).resolves.toBe(0);
  });

  it('refuse a clear request to a ship that is no trierarch, with 400', async () => {
    const manager = await crewedWithFleetScopes(['fleet:manage']);
    const scout = await commissioned();

    await expect(
      request('fleet/clearWorktree', { crewToken: manager.crewToken, body: { trierarchShipId: scout.shipId, shipId: scout.shipId, repository: 'aeolus-fleet' } }),
    ).resolves.toMatchObject({ status: 400, body: { code: 'BAD_REQUEST', message: `${scout.name} is no trierarch: only a trierarch clears a worktree it kept` } });
  });

  it('refuse a ship with crew:run a ship not assigned to it, with 403', async () => {
    const trierarch = await crewedWithFleetScopes(['crew:run']);
    const scout = await commissioned();

    await expect(request('fleet/getStartingPrompt', { crewToken: trierarch.crewToken, body: { shipId: scout.shipId } })).resolves.toMatchObject({
      status: 403,
      body: { code: 'FORBIDDEN' },
    });
  });

  it('refuse the fleet list with 403 to a ship without fleet:read', async () => {
    const agent = await commissioned();
    const crewToken = await register(agent);

    await expect(request('fleet/list', { crewToken, method: 'POST' })).resolves.toEqual({
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
