import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { addAgentShip, identityUseCases, initialiseFleet } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import type { RateLimit } from './rate-limiter.js';
import { buildHttpServer } from './server.js';

const DAY_S = 24 * 60 * 60;

let core: InMemoryCore;
let secret: string;
let server: FastifyInstance;

const reachable = () => Promise.resolve();
const unreachable = () => Promise.reject(new Error('connect ECONNREFUSED'));

function start(options: { checkDatabase?: () => Promise<void>; signInRateLimit?: RateLimit } = {}) {
  server = buildHttpServer({
    useCases: {
      ...identityUseCases(core),
      ping: () => Promise.resolve({ serverTime: core.clock.now(), fleetCount: 1 }),
    },
    checkDatabase: options.checkDatabase ?? reachable,
    clock: core.clock,
    logger: false,
    signInRateLimit: options.signInRateLimit,
  });
}

beforeEach(async () => {
  core = createInMemoryCore('2026-09-29T12:00:00.000Z');
  ({ secret } = await initialiseFleet(core));
});

afterEach(async () => {
  await server.close();
});

function signIn(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return server.inject({ method: 'POST', url: '/trpc/console.signIn', payload: body, headers });
}

/** Like the tRPC client: a JSON content type and no body. */
function signOut(cookie: string) {
  return server.inject({
    method: 'POST',
    url: '/trpc/console.signOut',
    headers: { cookie, 'content-type': 'application/json' },
  });
}

function ping(headers: Record<string, string> = {}) {
  return server.inject({ method: 'GET', url: '/trpc/system.ping', headers });
}

/** The `name=value` part of the response's Set-Cookie header. */
function cookieOf(response: { headers: Record<string, unknown> }): string {
  const header = response.headers['set-cookie'];
  if (typeof header !== 'string') {
    throw new Error('expected one Set-Cookie header');
  }
  return header.split(';')[0] ?? '';
}

const trpcErrorBody = z.object({ error: z.object({ data: z.object({ code: z.string() }) }) });

function errorCode(response: { json: () => unknown }): string | undefined {
  return trpcErrorBody.safeParse(response.json()).data?.error.data.code;
}

describe('/health', () => {
  it('reports the server up and the database up, and nothing about fleets', async () => {
    start();

    const response = await server.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ server: 'up', database: 'up' });
  });

  it('answers 503 with the database down', async () => {
    start({ checkDatabase: unreachable });

    const response = await server.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ server: 'up', database: 'down' });
  });
});

describe('console.signIn', () => {
  it('sets an httpOnly, Secure, SameSite=Strict session cookie valid 30 days', async () => {
    start();

    const response = await signIn({ secret });

    expect(response.statusCode).toBe(200);
    const header = response.headers['set-cookie'];
    expect(header).toMatch(/^aeolus_session=[^;]+; Max-Age=2592000; Path=\/; HttpOnly; Secure; SameSite=Strict$/);
    expect(header).not.toContain(secret);
  });

  it('refuses a wrong secret with 401 and sets no cookie', async () => {
    start();

    const response = await signIn({ secret: 'aeolus_sk_v1_wrong' });

    expect(response.statusCode).toBe(401);
    expect(errorCode(response)).toBe('UNAUTHORIZED');
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it("refuses an agent ship's secret with 403", async () => {
    start();
    const agent = addAgentShip(core, { fleetId: core.state.fleets[0]?.id ?? expect.unreachable() });

    const response = await signIn({ secret: agent.secret });

    expect(response.statusCode).toBe(403);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('refuses an empty secret with 400', async () => {
    start();

    const response = await signIn({ secret: '  ' });

    expect(response.statusCode).toBe(400);
  });

  it('refuses further attempts from a client over the rate limit with 429', async () => {
    start({ signInRateLimit: { limit: 3, windowMs: 60_000 } });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await signIn({ secret: 'aeolus_sk_v1_wrong' })).statusCode).toBe(401);
    }

    const limited = await signIn({ secret });

    expect(limited.statusCode).toBe(429);
    expect(errorCode(limited)).toBe('TOO_MANY_REQUESTS');
    expect(limited.headers['set-cookie']).toBeUndefined();
    core.clock.advance(60_000);
    expect((await signIn({ secret })).statusCode).toBe(200);
  });

  it('counts attempts per client address', async () => {
    start({ signInRateLimit: { limit: 1, windowMs: 60_000 } });

    expect((await signIn({ secret }, {})).statusCode).toBe(200);
    const fromElsewhere = await server.inject({
      method: 'POST',
      url: '/trpc/console.signIn',
      payload: { secret },
      remoteAddress: '203.0.113.7',
    });

    expect(fromElsewhere.statusCode).toBe(200);
  });
});

describe('a procedure that needs a scope', () => {
  it('refuses a call without a secret or a session with 401', async () => {
    start();

    const response = await ping();

    expect(response.statusCode).toBe(401);
    expect(errorCode(response)).toBe('UNAUTHORIZED');
  });

  it('refuses a ship without the scope with 403', async () => {
    start();
    const agent = addAgentShip(core, { fleetId: core.state.fleets[0]?.id ?? expect.unreachable() });

    const response = await ping({ authorization: `Bearer ${agent.secret}` });

    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { message: string } }>().error.message).toBe('This call needs the fleet:read scope');
  });

  it('serves a ship with the scope, by secret', async () => {
    start();

    const response = await ping({ authorization: `Bearer ${secret}` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ result: { data: { serverTime: '2026-09-29T12:00:00.000Z', fleetCount: 1 } } });
  });

  it('refuses a wrong bearer secret even with a valid session cookie', async () => {
    start();
    const cookie = cookieOf(await signIn({ secret }));

    const response = await ping({ authorization: 'Bearer aeolus_sk_v1_wrong', cookie });

    expect(response.statusCode).toBe(401);
  });

  it('serves the console session, and renews its cookie for 30 days from this use', async () => {
    start();
    const cookie = cookieOf(await signIn({ secret }));
    core.clock.advance(10 * DAY_S * 1000);

    const response = await ping({ cookie });

    expect(response.statusCode).toBe(200);
    expect(response.headers['set-cookie']).toBe(`${cookie}; Max-Age=${String(30 * DAY_S)}; Path=/; HttpOnly; Secure; SameSite=Strict`);
  });

  it('refuses an expired console session with 401', async () => {
    start();
    const cookie = cookieOf(await signIn({ secret }));
    core.clock.advance(30 * DAY_S * 1000);

    expect((await ping({ cookie })).statusCode).toBe(401);
  });

  it('refuses the first session after a second sign-in', async () => {
    start();
    const first = cookieOf(await signIn({ secret }));
    const second = cookieOf(await signIn({ secret }));

    expect((await ping({ cookie: first })).statusCode).toBe(401);
    expect((await ping({ cookie: second })).statusCode).toBe(200);
  });

  it('answers 500 when the use case fails', async () => {
    server = buildHttpServer({
      useCases: { ...identityUseCases(core), ping: () => Promise.reject(new Error('database unreachable')) },
      checkDatabase: reachable,
      clock: core.clock,
      logger: false,
    });

    expect((await ping({ authorization: `Bearer ${secret}` })).statusCode).toBe(500);
  });
});

describe('console.signOut', () => {
  it('ends the session and clears the cookie', async () => {
    start();
    const cookie = cookieOf(await signIn({ secret }));

    const response = await signOut(cookie);

    expect(response.statusCode).toBe(200);
    expect(response.headers['set-cookie']).toBe('aeolus_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict');
    expect((await ping({ cookie })).statusCode).toBe(401);
    expect(core.state.leases.every((lease) => lease.endedAt !== null)).toBe(true);
  });

  it('clears the cookie even without a live session', async () => {
    start();

    const response = await signOut('aeolus_session=unknown');

    expect(response.statusCode).toBe(200);
    expect(response.headers['set-cookie']).toContain('Max-Age=0');
  });
});
