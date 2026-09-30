import type { FleetId } from '@aeolus-fleet/common';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  addAgentShip,
  crewShip,
  identityUseCases,
  initialiseFleet,
  messagingUseCases,
  OPERATOR,
  registryUseCases,
} from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import type { RateLimit } from '../http/rate-limiter.js';
import { buildHttpServer } from '../http/server.js';
import type { UseCases } from '../trpc/context.js';
import { SHIP_CALLS } from '../trpc/ship-contract.js';
import { SHIP_PROTOCOL } from '../trpc/ship-protocol.js';
import { registerRestApi } from './rest-api.js';

// The ship contract as REST at /api/v1, through the HTTP host on the
// in-memory core: the OpenAPI spec, the crew token as a bearer, and how a
// refusal or a failure reads. The whole flow on Postgres is in
// test/rest.integration.test.ts.

const FLEET_ORIGIN = 'https://fleet.example.com';
const ID_BODY = '[0-7][0-9a-hjkmnp-tv-z]{25}';

let core: InMemoryCore;
let fleetId: FleetId;
let server: FastifyInstance;

beforeEach(async () => {
  core = createInMemoryCore('2026-09-30T12:00:00.000Z');
  ({ fleetId } = await initialiseFleet(core));
});

afterEach(async () => {
  await server.close();
});

function useCasesOf(overrides: Partial<UseCases> = {}): UseCases {
  return {
    ...identityUseCases(core),
    ...registryUseCases(core),
    ...messagingUseCases(core),
    ping: () => Promise.resolve({ serverTime: core.clock.now(), fleetCount: 1 }),
    ...overrides,
  };
}

function start(options: { useCases?: UseCases; registerRateLimit?: RateLimit; logLines?: string[] } = {}): void {
  const { logLines } = options;
  server = buildHttpServer({
    useCases: options.useCases ?? useCasesOf(),
    checkDatabase: () => Promise.resolve(),
    clock: core.clock,
    logger: logLines
      ? {
          level: 'error',
          stream: {
            write: (line: string) => {
              logLines.push(line);
            },
          },
        }
      : false,
    registerRateLimit: options.registerRateLimit,
    consoleOrigin: FLEET_ORIGIN,
  });
}

/** A new agent ship a session crews, straight into the state: its crew token. */
function crewedShip(name?: string): string {
  const { shipId } = addAgentShip(core, { fleetId, name });
  return crewShip(core, { fleetId, shipId });
}

const operationSchema = z.object({
  operationId: z.string(),
  description: z.string(),
  security: z.array(z.record(z.string(), z.array(z.string()))),
  requestBody: z
    .object({
      required: z.boolean(),
      content: z.object({ 'application/json': z.object({ schema: z.record(z.string(), z.unknown()) }) }),
    })
    .optional(),
  responses: z.record(
    z.string(),
    z.object({
      description: z.string(),
      content: z.object({ 'application/json': z.object({ schema: z.record(z.string(), z.unknown()) }) }),
    }),
  ),
});

const specSchema = z.object({
  openapi: z.string(),
  info: z.object({ title: z.string(), version: z.string(), description: z.string() }),
  servers: z.array(z.object({ url: z.string() })),
  paths: z.record(z.string(), z.record(z.string(), operationSchema)),
  components: z.object({
    securitySchemes: z.record(z.string(), z.record(z.string(), z.string())),
    schemas: z.record(z.string(), z.record(z.string(), z.unknown())),
  }),
});

async function spec(): Promise<z.infer<typeof specSchema>> {
  const response = await server.inject({ method: 'GET', url: '/api/v1/openapi.json' });
  expect(response.statusCode).toBe(200);
  return specSchema.parse(response.json());
}

async function operation(path: string, method: string): Promise<z.infer<typeof operationSchema>> {
  const found = (await spec()).paths[path]?.[method];
  if (!found) {
    throw new Error(`No ${method} ${path} in the spec`);
  }
  return found;
}

describe('the OpenAPI spec at /api/v1/openapi.json', () => {
  it('is an OpenAPI 3.1 document for the ship contract under /api/v1', async () => {
    start();

    const document = await spec();

    expect(document.openapi).toMatch(/^3\.1\.\d+$/);
    expect(document.servers).toEqual([{ url: '/api/v1' }]);
    expect(document.info.description).toMatch(/Authorization: Bearer/);
  });

  it('states the ship protocol in its description, as the MCP server instructions do', async () => {
    start();

    const document = await spec();

    expect(document.info.description.startsWith(`${SHIP_PROTOCOL}\n\n`)).toBe(true);
  });

  it('lists every ship procedure: whoami to GET, the others to POST', async () => {
    start();

    const { paths } = await spec();

    expect(Object.entries(paths).map(([path, methods]) => [path, Object.keys(methods)])).toEqual([
      ['/ship/register', ['post']],
      ['/ship/whoami', ['get']],
      ['/ship/send', ['post']],
      ['/ship/receive', ['post']],
      ['/ship/ack', ['post']],
      ['/ship/deregister', ['post']],
    ]);
  });

  it('describes each operation with the rules its procedure states, as the MCP tool does', async () => {
    start();

    const { paths } = await spec();

    for (const call of SHIP_CALLS) {
      const described = paths[`/ship/${call.name}`]?.[call.type === 'query' ? 'get' : 'post'];
      expect(described?.operationId, call.name).toBe(call.name);
      expect(described?.description, call.name).toBe(call.description);
    }
    expect(paths['/ship/receive']?.post?.description).toMatch(/about 25 seconds/);
  });

  it('asks every operation but register for the crew token as a bearer', async () => {
    start();

    const document = await spec();

    expect(document.components.securitySchemes.crewToken).toMatchObject({ type: 'http', scheme: 'bearer' });
    for (const [path, methods] of Object.entries(document.paths)) {
      for (const described of Object.values(methods)) {
        expect(described.security, path).toEqual(path === '/ship/register' ? [] : [{ crewToken: [] }]);
      }
    }
  });

  it("describes send's body with the schema the router parses it with, and its answer", async () => {
    start();

    const send = await operation('/ship/send', 'post');

    expect(send.requestBody?.required).toBe(true);
    expect(send.requestBody?.content['application/json'].schema).toMatchObject({
      type: 'object',
      required: ['selector', 'payload', 'idempotencyKey'],
      properties: { inReplyTo: { type: 'string', pattern: `^msg_${ID_BODY}$` } },
    });
    expect(send.responses['200']?.content['application/json'].schema).toMatchObject({
      type: 'object',
      properties: { messageId: { pattern: `^msg_${ID_BODY}$` } },
    });
  });

  it('leaves the body of receive optional, and gives whoami and deregister none', async () => {
    start();

    expect((await operation('/ship/receive', 'post')).requestBody?.required).toBe(false);
    expect((await operation('/ship/whoami', 'get')).requestBody).toBeUndefined();
    expect((await operation('/ship/deregister', 'post')).requestBody).toBeUndefined();
  });

  it('describes what a refusal or a failure answers: its code, its message, and for a failure the request id', async () => {
    start();

    const document = await spec();
    const ack = await operation('/ship/ack', 'post');

    expect(ack.responses.default?.content['application/json'].schema).toEqual({ $ref: '#/components/schemas/Error' });
    expect(document.components.schemas.Error).toMatchObject({
      type: 'object',
      required: ['code', 'message'],
      properties: { code: { type: 'string' }, message: { type: 'string' }, requestId: { type: 'string' } },
    });
  });
});

describe('the API docs at /api/v1/docs', () => {
  const DOCS_PAGE = '/api/v1/docs/';
  const FLEET_URL = 'https://fleet.example.com';

  async function docsPage(): Promise<string> {
    const response = await server.inject({ method: 'GET', url: DOCS_PAGE });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/html/);
    return response.body;
  }

  /** Every URL the page loads: its src and href attributes, resolved against the page. */
  function loadedBy(page: string): URL[] {
    return [...page.matchAll(/\s(?:src|href)="([^"]+)"/g)].map(([, url]) => new URL(url ?? '', `${FLEET_URL}${DOCS_PAGE}`));
  }

  /** What the page hands the viewer: the configuration in its call to Scalar.createApiReference. */
  function viewerConfiguration(page: string): Record<string, unknown> {
    const configuration = /Scalar\.createApiReference\('#app', (\{[\s\S]*?\})\)\s*<\/script>/.exec(page)?.[1];
    if (configuration === undefined) {
      throw new Error('The page never starts the viewer');
    }
    return z.record(z.string(), z.unknown()).parse(JSON.parse(configuration));
  }

  it('sends /api/v1/docs on to the page at /api/v1/docs/', async () => {
    start();

    const response = await server.inject({ method: 'GET', url: '/api/v1/docs' });

    expect(response.statusCode).toBe(301);
    expect(response.headers.location).toBe(DOCS_PAGE);
  });

  it('answers with the viewer, rendering the spec at /api/v1/openapi.json', async () => {
    start();

    const page = await docsPage();

    expect(viewerConfiguration(page)).toMatchObject({ url: '/api/v1/openapi.json' });
  });

  it('titles the page as the spec is titled: Aeolus ship API', async () => {
    start();

    const page = await docsPage();

    expect(/<title>([^<]*)<\/title>/.exec(page)?.[1]).toBe('Aeolus ship API');
    expect((await spec()).info.title).toBe('Aeolus ship API');
  });

  it("talks only to the fleet's own server: it serves the viewer's script itself, with Scalar's agent, developer tools, telemetry and request proxy off", async () => {
    start();

    const page = await docsPage();
    const loaded = loadedBy(page);
    const answers = await Promise.all(
      loaded.map((url) => server.inject({ method: 'GET', url: `${url.pathname}${url.search}` })),
    );
    const configuration = viewerConfiguration(page);

    expect(loaded).not.toEqual([]);
    expect(loaded.map((url) => url.origin)).toEqual(loaded.map(() => FLEET_URL));
    expect(answers.map((answer) => answer.statusCode)).toEqual(loaded.map(() => 200));
    expect(configuration).toMatchObject({ agent: { disabled: true }, showDeveloperTools: 'never', telemetry: false });
    // Without a proxy, "Try it" calls the fleet itself, at the spec's relative server /api/v1.
    expect(configuration).not.toHaveProperty('proxyUrl');
  });

  it("keeps the viewer off Scalar's font CDN: it uses the browser's own fonts", async () => {
    start();

    const page = await docsPage();

    expect(viewerConfiguration(page)).toMatchObject({ withDefaultFonts: false });
  });
});

describe('a ship call at /api/v1', () => {
  it('answers with the output as JSON', async () => {
    start();
    const agent = addAgentShip(core, { fleetId, name: 'scout' });

    const registered = await server.inject({
      method: 'POST',
      url: '/api/v1/ship/register',
      payload: { shipId: agent.shipId, secret: agent.secret, location: { kind: 'CLOUD' } },
    });
    const { crewToken } = z.object({ crewToken: z.string() }).parse(registered.json());
    const whoami = await server.inject({
      method: 'GET',
      url: '/api/v1/ship/whoami',
      headers: { authorization: `Bearer ${crewToken}` },
    });

    expect(registered.statusCode).toBe(200);
    expect(whoami.statusCode).toBe(200);
    expect(whoami.json()).toEqual({ shipId: agent.shipId, fleetId, name: 'scout', type: 'reviewer' });
  });

  it('takes the crew token from the bearer only: the console session cookie is no crew token', async () => {
    start();
    const signedIn = await server.inject({
      method: 'POST',
      url: '/trpc/console.signIn',
      payload: OPERATOR,
      headers: { origin: FLEET_ORIGIN },
    });
    const cookie = signedIn.headers['set-cookie']?.toString().split(';')[0] ?? '';

    const whoami = await server.inject({
      method: 'GET',
      url: '/api/v1/ship/whoami',
      headers: { cookie, origin: FLEET_ORIGIN },
    });

    expect(signedIn.statusCode).toBe(200);
    expect(whoami.statusCode).toBe(401);
    expect(whoami.headers['set-cookie']).toBeUndefined();
  });

  it("refuses with the HTTP status of the refusal's code, answering its code and message", async () => {
    start();

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/ship/whoami',
      headers: { authorization: 'Bearer aeolus_ct_v1_wrong' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ code: 'UNAUTHORIZED', message: 'Call with the crew token register gave you' });
  });

  it.each([
    { method: 'GET', call: 'whoami', payload: undefined },
    {
      method: 'POST',
      call: 'send',
      payload: { selector: { kind: 'ship', name: 'scout' }, payload: 'Anyone aboard?', idempotencyKey: 'key-1' },
    },
    { method: 'POST', call: 'receive', payload: undefined },
  ] as const)('refuses $method $call without a crew token or with a wrong one, naming only the crew token: a ship has no console to sign in to', async ({ method, call, payload }) => {
    start();

    const without = await server.inject({ method, url: `/api/v1/ship/${call}`, payload });
    const wrong = await server.inject({
      method,
      url: `/api/v1/ship/${call}`,
      payload,
      headers: { authorization: 'Bearer aeolus_ct_v1_wrong' },
    });

    for (const response of [without, wrong]) {
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ code: 'UNAUTHORIZED', message: 'Call with the crew token register gave you' });
    }
  });

  it.each([
    { method: 'GET', call: 'whoami', payload: undefined },
    {
      method: 'POST',
      call: 'send',
      payload: { selector: { kind: 'ship', name: 'scout' }, payload: 'Anyone aboard?', idempotencyKey: 'key-1' },
    },
    { method: 'POST', call: 'receive', payload: undefined },
    { method: 'POST', call: 'deregister', payload: undefined },
  ] as const)('refuses $method $call with a crew token whose lease has ended with 401 and LEASE_ENDED: the ship was released', async ({ method, call, payload }) => {
    start();
    const crewToken = crewedShip('scout');
    const authorization = `Bearer ${crewToken}`;
    const deregistered = await server.inject({ method: 'POST', url: '/api/v1/ship/deregister', headers: { authorization } });

    const response = await server.inject({ method, url: `/api/v1/ship/${call}`, payload, headers: { authorization } });

    expect(deregistered.statusCode).toBe(200);
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ code: 'LEASE_ENDED', message: 'This ship was released; this session no longer crews it.' });
  });

  it('refuses input that does not parse with 400, naming the field and what it must be', async () => {
    start();
    const crewToken = crewedShip();

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/ship/ack',
      headers: { authorization: `Bearer ${crewToken}` },
      payload: { deliveryId: core.ids('message') },
    });

    const { code, message } = z.object({ code: z.string(), message: z.string() }).parse(response.json());
    expect(response.statusCode).toBe(400);
    expect(code).toBe('BAD_REQUEST');
    expect(message).toContain('must be a delivery id (dlv_...)');
    expect(message).toContain('deliveryId');
  });

  it('receives without a body: one delivery at most', async () => {
    start();
    const crewToken = crewedShip();

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/ship/receive',
      headers: { authorization: `Bearer ${crewToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ deliveries: [] });
    expect(core.wakeups.waits).toHaveLength(1);
  });

  it('counts a failed register against the client address, in one budget with /trpc', async () => {
    start({ registerRateLimit: { limit: 2, windowMs: 60_000 } });
    const agent = addAgentShip(core, { fleetId });
    const aWrongClaim = { shipId: core.ids('ship'), secret: 'aeolus_sk_v1_wrong', location: { kind: 'DEVICE' } };

    const overTrpc = await server.inject({ method: 'POST', url: '/trpc/ship.register', payload: aWrongClaim });
    const overRest = await server.inject({ method: 'POST', url: '/api/v1/ship/register', payload: aWrongClaim });
    const limited = await server.inject({
      method: 'POST',
      url: '/api/v1/ship/register',
      payload: { shipId: agent.shipId, secret: agent.secret, location: { kind: 'DEVICE' } },
    });

    expect([overTrpc.statusCode, overRest.statusCode, limited.statusCode]).toEqual([401, 401, 429]);
    expect(limited.json()).toEqual({
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many failed register attempts. Wait a minute.',
    });
    expect(core.state.leases.filter((lease) => lease.shipId === agent.shipId)).toEqual([]);
  });

  it("answers a server failure with 500, a generic message and the request's id, and logs the whole failure under that id", async () => {
    const logLines: string[] = [];
    start({ useCases: useCasesOf({ whoami: () => Promise.reject(new Error('database unreachable')) }), logLines });
    const crewToken = crewedShip();

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/ship/whoami',
      headers: { authorization: `Bearer ${crewToken}` },
    });

    const answered = z
      .strictObject({ code: z.literal('INTERNAL_SERVER_ERROR'), message: z.literal('Internal error'), requestId: z.string() })
      .parse(response.json());
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('database unreachable');
    const [logged, ...more] = logLines.map((line) => z.record(z.string(), z.unknown()).parse(JSON.parse(line)));
    expect(more).toEqual([]);
    expect(logged).toMatchObject({
      msg: 'procedure failed',
      reqId: answered.requestId,
      path: 'ship.whoami',
      reason: 'database unreachable',
    });
    expect(logged?.stack).toMatch(/^Error: database unreachable\n\s+at \S/);
  });
});

describe('a failure inside the REST adapter, outside any procedure', () => {
  it("answers 500 with the generic message and the request's id, and logs the whole failure under that id", async () => {
    const logLines: string[] = [];
    server = Fastify({ logger: { level: 'error', stream: { write: (line: string) => void logLines.push(line) } } });
    registerRestApi(server, {
      contextFor: () => {
        throw new Error('context lost');
      },
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/ship/whoami',
      headers: { authorization: 'Bearer aeolus_ct_v1_crew' },
    });

    const answered = z
      .strictObject({ code: z.literal('INTERNAL_SERVER_ERROR'), message: z.literal('Internal error'), requestId: z.string() })
      .parse(response.json());
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('context lost');
    const [logged, ...more] = logLines.map((line) => z.record(z.string(), z.unknown()).parse(JSON.parse(line)));
    expect(more).toEqual([]);
    expect(logged).toMatchObject({ msg: 'request failed', reqId: answered.requestId, reason: 'context lost' });
    expect(logged?.stack).toMatch(/^Error: context lost\n\s+at \S/);
  });

  it("leaves Fastify's own refusal of a body that is not JSON a refusal: 400, never a server failure", async () => {
    start();
    const crewToken = crewedShip();

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/ship/send',
      headers: { authorization: `Bearer ${crewToken}`, 'content-type': 'application/json' },
      payload: '{ not json',
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain('Internal error');
  });
});
