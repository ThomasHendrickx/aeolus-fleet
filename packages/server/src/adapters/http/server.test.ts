import type { FleetId, Scope } from '@aeolus-fleet/common';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  addAgentShip,
  crewShip,
  identityUseCases,
  initialiseFleet,
  OPERATOR,
  registryUseCases,
} from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import type { RateLimit } from './rate-limiter.js';
import { buildHttpServer } from './server.js';

const DAY_S = 24 * 60 * 60;

let core: InMemoryCore;
let server: FastifyInstance;

const reachable = () => Promise.resolve();
const unreachable = () => Promise.reject(new Error('connect ECONNREFUSED'));

function start(
  options: {
    checkDatabase?: () => Promise<void>;
    signInRateLimit?: RateLimit;
    cookieDomain?: string;
    consoleOrigin?: string;
  } = {},
) {
  server = buildHttpServer({
    useCases: {
      ...identityUseCases(core),
      ...registryUseCases(core),
      ping: () => Promise.resolve({ serverTime: core.clock.now(), fleetCount: 1 }),
    },
    checkDatabase: options.checkDatabase ?? reachable,
    clock: core.clock,
    logger: false,
    signInRateLimit: options.signInRateLimit,
    cookieDomain: options.cookieDomain,
    consoleOrigin: options.consoleOrigin,
  });
}

beforeEach(async () => {
  core = createInMemoryCore('2026-09-29T12:00:00.000Z');
  await initialiseFleet(core);
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

function fleetIdOf(inMemory: InMemoryCore): FleetId {
  return inMemory.state.fleets[0]?.id ?? expect.unreachable();
}

/** An agent ship a session crews, straight into the state; returns its crew token. */
function crewedAgent(scopes?: Scope[]): string {
  const agent = addAgentShip(core, { fleetId: fleetIdOf(core), scopes });
  return crewShip(core, { fleetId: fleetIdOf(core), shipId: agent.shipId });
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

    const response = await signIn(OPERATOR);

    expect(response.statusCode).toBe(200);
    const header = response.headers['set-cookie'];
    expect(header).toMatch(/^aeolus_session=[^;]+; Max-Age=2592000; Path=\/; HttpOnly; Secure; SameSite=Strict$/);
    expect(header).not.toContain(OPERATOR.password);
  });

  it('refuses a wrong password and an unknown email with the same 401, and sets no cookie', async () => {
    start();

    const wrongPassword = await signIn({ email: OPERATOR.email, password: 'wrong horse' });
    const unknownEmail = await signIn({ email: 'stranger@example.com', password: OPERATOR.password });

    expect(wrongPassword.statusCode).toBe(401);
    expect(errorCode(wrongPassword)).toBe('UNAUTHORIZED');
    expect(unknownEmail.statusCode).toBe(401);
    expect(unknownEmail.json()).toEqual(wrongPassword.json());
    expect(wrongPassword.headers['set-cookie']).toBeUndefined();
    expect(unknownEmail.headers['set-cookie']).toBeUndefined();
  });

  it.each([
    ['an empty email', { email: '  ', password: OPERATOR.password }],
    ['an empty password', { email: OPERATOR.email, password: '' }],
    ["argo's secret instead", { secret: 'aeolus_sk_v1_anything' }],
  ])('refuses %s with 400', async (_label, body) => {
    start();

    const response = await signIn(body);

    expect(response.statusCode).toBe(400);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('refuses further attempts from a client over the rate limit with 429', async () => {
    start({ signInRateLimit: { limit: 3, windowMs: 60_000 } });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await signIn({ email: OPERATOR.email, password: 'wrong horse' })).statusCode).toBe(401);
    }

    const limited = await signIn(OPERATOR);

    expect(limited.statusCode).toBe(429);
    expect(errorCode(limited)).toBe('TOO_MANY_REQUESTS');
    expect(limited.headers['set-cookie']).toBeUndefined();
    core.clock.advance(60_000);
    expect((await signIn(OPERATOR)).statusCode).toBe(200);
  });

  it('counts attempts per client address', async () => {
    start({ signInRateLimit: { limit: 1, windowMs: 60_000 } });

    expect((await signIn(OPERATOR, {})).statusCode).toBe(200);
    const fromElsewhere = await server.inject({
      method: 'POST',
      url: '/trpc/console.signIn',
      payload: OPERATOR,
      remoteAddress: '203.0.113.7',
    });

    expect(fromElsewhere.statusCode).toBe(200);
  });
});

describe('a procedure that needs a scope', () => {
  it('refuses a call without a crew token or a session with 401', async () => {
    start();

    const response = await ping();

    expect(response.statusCode).toBe(401);
    expect(errorCode(response)).toBe('UNAUTHORIZED');
    expect(response.json<{ error: { message: string } }>().error.message).toBe(
      'Sign in, or call with the crew token register gave you',
    );
  });

  it('refuses a ship without the scope with 403', async () => {
    start();
    const crewToken = crewedAgent();

    const response = await ping({ authorization: `Bearer ${crewToken}` });

    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { message: string } }>().error.message).toBe('This call needs the fleet:read scope');
  });

  it('serves a ship with the scope, by its crew token', async () => {
    start();
    const crewToken = crewedAgent(['fleet:read']);

    const response = await ping({ authorization: `Bearer ${crewToken}` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ result: { data: { serverTime: '2026-09-29T12:00:00.000Z', fleetCount: 1 } } });
  });

  it('refuses the ship secret as the bearer: the secret works only for register', async () => {
    start();
    const reader = addAgentShip(core, { fleetId: fleetIdOf(core), scopes: ['fleet:read'] });
    crewShip(core, { fleetId: fleetIdOf(core), shipId: reader.shipId });

    const response = await ping({ authorization: `Bearer ${reader.secret}` });

    expect(response.statusCode).toBe(401);
  });

  it('refuses a wrong bearer crew token even with a valid session cookie', async () => {
    start();
    const cookie = cookieOf(await signIn(OPERATOR));

    const response = await ping({ authorization: 'Bearer aeolus_ct_v1_wrong', cookie });

    expect(response.statusCode).toBe(401);
  });

  it('serves the console session, and renews its cookie for 30 days from this use', async () => {
    start();
    const cookie = cookieOf(await signIn(OPERATOR));
    core.clock.advance(10 * DAY_S * 1000);

    const response = await ping({ cookie });

    expect(response.statusCode).toBe(200);
    expect(response.headers['set-cookie']).toBe(`${cookie}; Max-Age=${String(30 * DAY_S)}; Path=/; HttpOnly; Secure; SameSite=Strict`);
  });

  it('refuses an expired console session with 401', async () => {
    start();
    const cookie = cookieOf(await signIn(OPERATOR));
    core.clock.advance(30 * DAY_S * 1000);

    expect((await ping({ cookie })).statusCode).toBe(401);
  });

  it('refuses the first session after a second sign-in', async () => {
    start();
    const first = cookieOf(await signIn(OPERATOR));
    const second = cookieOf(await signIn(OPERATOR));

    expect((await ping({ cookie: first })).statusCode).toBe(401);
    expect((await ping({ cookie: second })).statusCode).toBe(200);
  });

  it('answers 500 when the use case fails', async () => {
    server = buildHttpServer({
      useCases: {
        ...identityUseCases(core),
        ...registryUseCases(core),
        ping: () => Promise.reject(new Error('database unreachable')),
      },
      checkDatabase: reachable,
      clock: core.clock,
      logger: false,
    });

    const cookie = cookieOf(await signIn(OPERATOR));

    expect((await ping({ cookie })).statusCode).toBe(500);
  });
});

describe('console.signOut', () => {
  it('ends the session and clears the cookie', async () => {
    start();
    const cookie = cookieOf(await signIn(OPERATOR));

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

describe('a console on another host under the configured domain', () => {
  const CONSOLE_ORIGIN = 'https://console.fleet.example.com';
  const acrossHosts = { cookieDomain: 'fleet.example.com', consoleOrigin: CONSOLE_ORIGIN };

  function preflight(origin: string) {
    return server.inject({
      method: 'OPTIONS',
      url: '/trpc/console.signIn',
      headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
    });
  }

  it('gets a yes to its preflight: POST with a JSON body and credentials', async () => {
    start(acrossHosts);

    const response = await preflight(CONSOLE_ORIGIN);

    expect(response.statusCode).toBe(204);
    expect(response.headers).toMatchObject({
      'access-control-allow-origin': CONSOLE_ORIGIN,
      'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'GET, POST',
      'access-control-allow-headers': 'content-type',
      vary: 'Origin',
    });
  });

  it('signs in: the answer may be read with credentials, and the cookie is set for the whole domain', async () => {
    start(acrossHosts);

    const response = await signIn(OPERATOR, { origin: CONSOLE_ORIGIN });

    expect(response.statusCode).toBe(200);
    expect(response.headers).toMatchObject({
      'access-control-allow-origin': CONSOLE_ORIGIN,
      'access-control-allow-credentials': 'true',
    });
    expect(response.headers['set-cookie']).toMatch(
      /^aeolus_session=[^;]+; Max-Age=2592000; Domain=fleet\.example\.com; Path=\/; HttpOnly; Secure; SameSite=Strict$/,
    );
  });

  it('keeps the domain on the renewed cookie and on the cleared one', async () => {
    start(acrossHosts);
    const cookie = cookieOf(await signIn(OPERATOR, { origin: CONSOLE_ORIGIN }));

    const used = await ping({ cookie, origin: CONSOLE_ORIGIN });
    const signedOut = await server.inject({
      method: 'POST',
      url: '/trpc/console.signOut',
      headers: { cookie, origin: CONSOLE_ORIGIN, 'content-type': 'application/json' },
    });

    expect(used.statusCode).toBe(200);
    expect(used.headers['access-control-allow-origin']).toBe(CONSOLE_ORIGIN);
    expect(used.headers['set-cookie']).toContain('; Domain=fleet.example.com;');
    expect(signedOut.headers['set-cookie']).toBe(
      'aeolus_session=; Max-Age=0; Domain=fleet.example.com; Path=/; HttpOnly; Secure; SameSite=Strict',
    );
  });

  it('gives any other origin no permission to read an answer', async () => {
    start(acrossHosts);

    const answer = await signIn(OPERATOR, { origin: 'https://elsewhere.example.com' });
    const refusedPreflight = await preflight('https://elsewhere.example.com');

    expect(answer.headers['access-control-allow-origin']).toBeUndefined();
    expect(answer.headers['access-control-allow-credentials']).toBeUndefined();
    expect(refusedPreflight.statusCode).not.toBe(204);
    expect(refusedPreflight.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('gives no origin permission without a configured console origin, and sets a host-only cookie', async () => {
    start();

    const answer = await signIn(OPERATOR, { origin: CONSOLE_ORIGIN });

    expect(answer.headers['access-control-allow-origin']).toBeUndefined();
    expect(answer.headers['set-cookie']).not.toContain('Domain=');
  });
});
