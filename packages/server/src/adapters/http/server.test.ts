import { readFileSync } from 'node:fs';
import type { FleetId, Scope } from '@aeolus-fleet/common';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  addAgentShip,
  crewShip,
  identityUseCases,
  initialiseFleet,
  historyUseCases,
  messagingUseCases,
  OPERATOR,
  registryUseCases,
} from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import type { RateLimit } from './rate-limiter.js';
import { buildHttpServer } from './server.js';

const DAY_S = 24 * 60 * 60;
/** The console's origin in these tests: the fleet's own, as when no other one is configured. */
const FLEET_ORIGIN = 'https://fleet.example.com';

let core: InMemoryCore;
let server: FastifyInstance;

const serverPackage = z.object({ version: z.string() }).parse(
  JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')),
);
const commonPackage = z.object({ version: z.string() }).parse(
  JSON.parse(readFileSync(new URL('../../../../common/package.json', import.meta.url), 'utf8')),
);

const reachable = () => Promise.resolve();
const LATEST_MIGRATION = '20261001040000_lease_last_seen';
const unreachable = () => Promise.reject(new Error('connect ECONNREFUSED'));

function start(
  options: {
    checkDatabase?: () => Promise<void>;
    latestMigration?: () => Promise<string | null>;
    signInRateLimit?: RateLimit;
    registerRateLimit?: RateLimit;
    cookieDomain?: string;
    consoleOrigin?: string;
  } = {},
) {
  server = buildHttpServer({
    useCases: {
      ...identityUseCases(core),
      ...registryUseCases(core),
      ...messagingUseCases(core),
      ...historyUseCases(core),
      ping: () => Promise.resolve({ serverTime: core.clock.now(), fleetCount: 1 }),
    },
    checkDatabase: options.checkDatabase ?? reachable,
    latestMigration: options.latestMigration ?? (() => Promise.resolve(LATEST_MIGRATION)),
    clock: core.clock,
    logger: false,
    signInRateLimit: options.signInRateLimit,
    registerRateLimit: options.registerRateLimit,
    cookieDomain: options.cookieDomain,
    consoleOrigin: options.consoleOrigin ?? FLEET_ORIGIN,
  });
}

beforeEach(async () => {
  core = createInMemoryCore('2026-09-29T12:00:00.000Z');
  await initialiseFleet(core);
});

afterEach(async () => {
  await server.close();
});

/** From the console, unless the headers say another origin. */
function signIn(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return server.inject({
    method: 'POST',
    url: '/trpc/console.signIn',
    payload: body,
    headers: { origin: FLEET_ORIGIN, ...headers },
  });
}

/** Like the tRPC client in the console: a JSON content type and no body. */
function signOut(cookie: string, origin = FLEET_ORIGIN) {
  return server.inject({
    method: 'POST',
    url: '/trpc/console.signOut',
    headers: { cookie, origin, 'content-type': 'application/json' },
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

const trpcErrorBody = z.object({
  error: z.object({
    data: z.object({ code: z.string(), refusal: z.string().optional(), retryAt: z.string().optional() }),
  }),
});

/** The error data a refused tRPC call answers with. */
function errorData(response: { json: () => unknown }) {
  return trpcErrorBody.parse(response.json()).error.data;
}

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

describe('/api/version', () => {
  it("answers the versions the server runs, its own package's and common's, and the latest applied migration", async () => {
    start();

    const response = await server.inject({ method: 'GET', url: '/api/version' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      server: serverPackage.version,
      common: commonPackage.version,
      migration: LATEST_MIGRATION,
    });
  });

  it('answers no migration when the database cannot say, and the versions all the same', async () => {
    start({ latestMigration: () => Promise.reject(new Error('connect ECONNREFUSED')) });

    const response = await server.inject({ method: 'GET', url: '/api/version' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ server: serverPackage.version, migration: null });
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

  it('says when a client over the rate limit may try again: when its window ends', async () => {
    start({ signInRateLimit: { limit: 1, windowMs: 60_000 } });
    const windowStart = core.clock.now().getTime();
    await signIn({ email: OPERATOR.email, password: 'wrong horse' });
    core.clock.advance(15_000);

    const limited = await signIn(OPERATOR);

    expect(errorData(limited)).toMatchObject({
      code: 'TOO_MANY_REQUESTS',
      retryAt: new Date(windowStart + 60_000).toISOString(),
    });
  });

  it('counts attempts per client address', async () => {
    start({ signInRateLimit: { limit: 1, windowMs: 60_000 } });

    expect((await signIn(OPERATOR, {})).statusCode).toBe(200);
    const fromElsewhere = await server.inject({
      method: 'POST',
      url: '/trpc/console.signIn',
      payload: OPERATOR,
      headers: { origin: FLEET_ORIGIN },
      remoteAddress: '203.0.113.7',
    });

    expect(fromElsewhere.statusCode).toBe(200);
  });
});

describe('ship.register', () => {
  /** Like the tRPC client: a JSON body, and no credentials but the secret in it. */
  function register(input: { shipId: string; secret: string; location: Record<string, string> }, remoteAddress?: string) {
    return server.inject({ method: 'POST', url: '/trpc/ship.register', payload: input, remoteAddress });
  }

  function aWrongClaim() {
    return { shipId: core.ids('ship'), secret: 'aeolus_sk_v1_wrong', location: { kind: 'DEVICE' } };
  }

  it('returns the crew token for the secret, and whoami answers with that token', async () => {
    start();
    const agent = addAgentShip(core, { fleetId: fleetIdOf(core), name: 'scout' });

    const registered = await register({ shipId: agent.shipId, secret: agent.secret, location: { kind: 'CLOUD' } });
    const { crewToken } = z
      .object({ result: z.object({ data: z.object({ crewToken: z.string() }) }) })
      .parse(registered.json()).result.data;
    const whoami = await server.inject({
      method: 'GET',
      url: '/trpc/ship.whoami',
      headers: { authorization: `Bearer ${crewToken}` },
    });

    expect(registered.statusCode).toBe(200);
    expect(crewToken).toMatch(/^aeolus_ct_v1_./);
    expect(whoami.json()).toEqual({
      result: { data: { shipId: agent.shipId, fleetId: fleetIdOf(core), name: 'scout', type: 'reviewer' } },
    });
  });

  it('refuses a wrong ship id or secret with 401', async () => {
    start();

    const response = await register(aWrongClaim());

    expect(response.statusCode).toBe(401);
    expect(response.json<{ error: { message: string } }>().error.message).toBe('Wrong ship id or secret');
  });

  it('refuses every attempt from a client after too many wrong ship ids or secrets, with 429', async () => {
    start({ registerRateLimit: { limit: 3, windowMs: 60_000 } });
    const agent = addAgentShip(core, { fleetId: fleetIdOf(core) });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await register(aWrongClaim())).statusCode).toBe(401);
    }

    const limited = await register({ shipId: agent.shipId, secret: agent.secret, location: { kind: 'DEVICE' } });

    expect(limited.statusCode).toBe(429);
    expect(errorCode(limited)).toBe('TOO_MANY_REQUESTS');
    expect(core.state.leases.filter((lease) => lease.shipId === agent.shipId)).toEqual([]);
    core.clock.advance(60_000);
    expect(
      (await register({ shipId: agent.shipId, secret: agent.secret, location: { kind: 'DEVICE' } })).statusCode,
    ).toBe(200);
  });

  it('never limits successful claims: one address crews many ships', async () => {
    start({ registerRateLimit: { limit: 1, windowMs: 60_000 } });
    const agents = [1, 2, 3].map(() => addAgentShip(core, { fleetId: fleetIdOf(core) }));

    const statuses: number[] = [];
    for (const agent of agents) {
      statuses.push((await register({ shipId: agent.shipId, secret: agent.secret, location: { kind: 'CLOUD' } })).statusCode);
    }

    expect(statuses).toEqual([200, 200, 200]);
  });

  it('counts only a wrong ship id or secret: a crewed ship or a bad location leaves the limit alone', async () => {
    start({ registerRateLimit: { limit: 1, windowMs: 60_000 } });
    const crewed = addAgentShip(core, { fleetId: fleetIdOf(core) });
    const other = addAgentShip(core, { fleetId: fleetIdOf(core) });
    const claimCrewed = () => register({ shipId: crewed.shipId, secret: crewed.secret, location: { kind: 'DEVICE' } });

    const statuses = [
      (await claimCrewed()).statusCode,
      (await claimCrewed()).statusCode,
      (await claimCrewed()).statusCode,
      (await register({ shipId: other.shipId, secret: other.secret, location: { kind: 'OTHER' } })).statusCode,
      (await register(aWrongClaim())).statusCode,
      (await register(aWrongClaim())).statusCode,
    ];

    expect(statuses).toEqual([200, 409, 409, 400, 401, 429]);
  });

  it('counts failures per client address, apart from sign-in attempts', async () => {
    start({ registerRateLimit: { limit: 1, windowMs: 60_000 }, signInRateLimit: { limit: 1, windowMs: 60_000 } });

    expect((await register(aWrongClaim())).statusCode).toBe(401);
    expect((await register(aWrongClaim(), '203.0.113.7')).statusCode).toBe(401);
    expect((await register(aWrongClaim())).statusCode).toBe(429);
    expect((await signIn(OPERATOR)).statusCode).toBe(200);
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

  it('tells a session that a sign-in elsewhere ended that the operator signed in somewhere else', async () => {
    start();
    const first = cookieOf(await signIn(OPERATOR));
    cookieOf(await signIn(OPERATOR));

    const refused = await ping({ cookie: first });

    expect(refused.statusCode).toBe(401);
    expect(errorData(refused)).toMatchObject({ code: 'UNAUTHORIZED', refusal: 'SIGNED_IN_ELSEWHERE' });
  });

  it('tells a signed-out session only to sign in', async () => {
    start();
    const cookie = cookieOf(await signIn(OPERATOR));
    await signOut(cookie);

    const refused = await ping({ cookie });

    expect(refused.statusCode).toBe(401);
    expect(errorData(refused).refusal).toBeUndefined();
  });

  it('answers 500 when the use case fails', async () => {
    server = buildHttpServer({
      useCases: {
        ...identityUseCases(core),
        ...registryUseCases(core),
        ...messagingUseCases(core),
      ...historyUseCases(core),
        ping: () => Promise.reject(new Error('database unreachable')),
      },
      checkDatabase: reachable,
      latestMigration: () => Promise.resolve(LATEST_MIGRATION),
      clock: core.clock,
      logger: false,
      consoleOrigin: FLEET_ORIGIN,
    });

    const cookie = cookieOf(await signIn(OPERATOR));

    expect((await ping({ cookie })).statusCode).toBe(500);
  });
});

describe('error responses', () => {
  // Vitest sets NODE_ENV to test, which tRPC treats as development: unless
  // told otherwise, it puts the stack trace into every error it answers.

  /** Neither a stack property nor a stack frame line anywhere in the body. */
  function expectNoStackTrace(response: { body: string }): void {
    expect(response.body).not.toContain('"stack"');
    expect(response.body).not.toMatch(/\s{2,}at \S/);
  }

  /** A server whose ping fails as a lost database would, logging to `lines`. */
  function startWithFailingPing(lines: string[] = []): void {
    server = buildHttpServer({
      useCases: {
        ...identityUseCases(core),
        ...registryUseCases(core),
        ...messagingUseCases(core),
      ...historyUseCases(core),
        ping: () => Promise.reject(new Error('database unreachable')),
      },
      checkDatabase: reachable,
      latestMigration: () => Promise.resolve(null),
      clock: core.clock,
      logger: {
        level: 'error',
        stream: {
          write: (line: string) => {
            lines.push(line);
          },
        },
      },
      consoleOrigin: FLEET_ORIGIN,
    });
  }

  it('carry no stack trace for a refusal', async () => {
    start();

    const response = await ping();

    expect(response.statusCode).toBe(401);
    expectNoStackTrace(response);
  });

  it('carry no stack trace for input that does not parse', async () => {
    start();

    const response = await server.inject({
      method: 'POST',
      url: '/trpc/ship.register',
      payload: { shipId: 'not a ship id', secret: '', location: { kind: 'MOON' } },
    });

    expect(response.statusCode).toBe(400);
    expectNoStackTrace(response);
  });

  it('carry no stack trace for a failure', async () => {
    startWithFailingPing();
    const cookie = cookieOf(await signIn(OPERATOR));

    const response = await ping({ cookie });

    expect(response.statusCode).toBe(500);
    expectNoStackTrace(response);
  });

  const failureBody = z.object({
    error: z.object({ message: z.string(), data: z.object({ code: z.string(), requestId: z.string().min(1) }) }),
  });

  it("answer a failure with a generic message and the request's id, never the error's own words", async () => {
    startWithFailingPing();
    const cookie = cookieOf(await signIn(OPERATOR));

    const response = await ping({ cookie });

    const { error } = failureBody.parse(response.json());
    expect(error.message).toBe('Internal error');
    expect(error.data.code).toBe('INTERNAL_SERVER_ERROR');
    expect(response.body).not.toContain('database unreachable');
  });

  it('give every request its own id', async () => {
    startWithFailingPing();
    const cookie = cookieOf(await signIn(OPERATOR));

    const first = failureBody.parse((await ping({ cookie })).json());
    const second = failureBody.parse((await ping({ cookie })).json());

    expect(first.error.data.requestId).not.toBe(second.error.data.requestId);
  });

  it("keep a refusal's own code and message, with no request id", async () => {
    start();

    const response = await ping();

    expect(response.json()).toEqual({
      error: {
        message: 'Sign in, or call with the crew token register gave you',
        code: -32001,
        data: { code: 'UNAUTHORIZED', httpStatus: 401, path: 'system.ping' },
      },
    });
  });

  it("leave the whole failure in the server log under the request's id: its path, its reason and its stack", async () => {
    const lines: string[] = [];
    startWithFailingPing(lines);
    const cookie = cookieOf(await signIn(OPERATOR));

    const { error } = failureBody.parse((await ping({ cookie })).json());

    const [logged, ...more] = lines.map((line) => z.record(z.string(), z.unknown()).parse(JSON.parse(line)));
    expect(more).toEqual([]);
    expect(logged).toMatchObject({
      msg: 'procedure failed',
      reqId: error.data.requestId,
      path: 'system.ping',
      reason: 'database unreachable',
    });
    expect(logged?.stack).toMatch(/^Error: database unreachable\n\s+at \S/);
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

  it("gives another host no permission when the console runs on the fleet's own origin, and sets a host-only cookie", async () => {
    start();

    const fromAnotherHost = await signIn(OPERATOR, { origin: CONSOLE_ORIGIN });
    const fromTheConsole = await signIn(OPERATOR);

    expect(fromAnotherHost.headers['access-control-allow-origin']).toBeUndefined();
    expect(fromTheConsole.headers['set-cookie']).not.toContain('Domain=');
  });
});

describe("state-changing console calls come from the console's origin", () => {
  const ELSEWHERE = 'https://elsewhere.fleet.example.com';
  const refusal = "A console call that changes state must come from the console's origin";

  function commission(headers: Record<string, string>) {
    return server.inject({
      method: 'POST',
      url: '/trpc/fleet.commission',
      payload: { name: 'stowaway', type: 'reviewer' },
      headers,
    });
  }

  function stowaways() {
    return core.state.ships.filter((ship) => ship.name === 'stowaway');
  }

  it('refuses a sign-in from another origin with 403, and sets no cookie', async () => {
    start();

    const response = await signIn(OPERATOR, { origin: ELSEWHERE });

    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { message: string } }>().error.message).toBe(refusal);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(core.state.consoleSessions).toEqual([]);
  });

  it('refuses a sign-in without an Origin header', async () => {
    start();

    const response = await server.inject({ method: 'POST', url: '/trpc/console.signIn', payload: OPERATOR });

    expect(response.statusCode).toBe(403);
  });

  it('refuses a sign-out from another origin: the session stays', async () => {
    start();
    const cookie = cookieOf(await signIn(OPERATOR));

    const response = await signOut(cookie, ELSEWHERE);

    expect(response.statusCode).toBe(403);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect((await ping({ cookie })).statusCode).toBe(200);
  });

  it('refuses a mutation with the session cookie from another origin, or without one, and changes nothing', async () => {
    start();
    const cookie = cookieOf(await signIn(OPERATOR));

    const fromElsewhere = await commission({ cookie, origin: ELSEWHERE });
    const withoutOrigin = await commission({ cookie });

    expect([fromElsewhere.statusCode, withoutOrigin.statusCode]).toEqual([403, 403]);
    expect(stowaways()).toEqual([]);
  });

  it('serves a mutation with the session cookie from the console origin', async () => {
    start();
    const cookie = cookieOf(await signIn(OPERATOR));

    const response = await commission({ cookie, origin: FLEET_ORIGIN });

    expect(response.statusCode).toBe(200);
    expect(stowaways()).toHaveLength(1);
  });

  it('serves a query with the session cookie from another origin: it changes nothing in the fleet, and CORS keeps the answer from that page', async () => {
    start();
    const cookie = cookieOf(await signIn(OPERATOR));

    expect((await ping({ cookie, origin: ELSEWHERE })).statusCode).toBe(200);
  });

  it('does not check the Origin of a mutation called with a crew token: no browser sends one by itself', async () => {
    start();
    const crewToken = crewedAgent(['fleet:manage']);

    const response = await commission({ authorization: `Bearer ${crewToken}` });

    expect(response.statusCode).toBe(200);
    expect(stowaways()).toHaveLength(1);
  });
});

describe('text input holding the character U+0000', () => {
  // Postgres text can never store U+0000, so one check at the door refuses it
  // in any text input, as a bad request that names the field.
  const nulMessage = (field: string) => `The input field ${field} cannot hold the character U+0000 (NUL)`;

  const refusal = z.object({ error: z.object({ message: z.string(), data: z.object({ code: z.string() }) }) });

  it('refuses a note holding it with 400, and commissions nothing', async () => {
    start();
    const cookie = cookieOf(await signIn(OPERATOR));
    const ships = core.state.ships.length;

    const response = await server.inject({
      method: 'POST',
      url: '/trpc/fleet.commission',
      payload: { name: 'scout', type: 'reviewer', note: 'reviews\u0000 pull requests' },
      headers: { cookie, origin: FLEET_ORIGIN },
    });

    expect(response.statusCode).toBe(400);
    expect(refusal.parse(response.json()).error.message).toBe(nulMessage('note'));
    expect(core.state.ships).toHaveLength(ships);
  });

  it('refuses a location description holding it with 400, naming the nested field, and opens no lease', async () => {
    start();
    const agent = addAgentShip(core, { fleetId: fleetIdOf(core) });

    const response = await server.inject({
      method: 'POST',
      url: '/trpc/ship.register',
      payload: { shipId: agent.shipId, secret: agent.secret, location: { kind: 'OTHER', description: 'ci\u0000runner' } },
    });

    expect(response.statusCode).toBe(400);
    expect(refusal.parse(response.json()).error.message).toBe(nulMessage('location.description'));
    expect(core.state.leases.filter((lease) => lease.shipId === agent.shipId)).toEqual([]);
  });

  it('refuses a sign-in whose password holds it with 400', async () => {
    start();

    const response = await signIn({ ...OPERATOR, password: `${OPERATOR.password}\u0000` });

    expect(response.statusCode).toBe(400);
    expect(refusal.parse(response.json()).error.message).toBe(nulMessage('password'));
  });

  it('refuses a payload holding it with 400, and sends nothing', async () => {
    start();
    const crewToken = crewedAgent();

    const response = await server.inject({
      method: 'POST',
      url: '/trpc/ship.send',
      payload: {
        selector: { kind: 'ship', name: 'argo' },
        payload: 'review\u0000',
        contentType: 'text/plain',
        idempotencyKey: 'review-22',
      },
      headers: { authorization: `Bearer ${crewToken}` },
    });

    expect(response.statusCode).toBe(400);
    expect(refusal.parse(response.json()).error.message).toBe(nulMessage('payload'));
    expect(core.state.messages).toEqual([]);
  });
});

describe('errors Fastify raises itself', () => {
  // Before any route runs, Fastify refuses a request it cannot read. Those
  // refusals have the shape of every other: a code and a message.

  it('refuse a body that is not JSON with 400 BAD_REQUEST', async () => {
    start();

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/ship/send',
      headers: { 'content-type': 'application/json' },
      payload: '{ not json',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ code: 'BAD_REQUEST', message: 'The request body is not valid JSON' });
  });

  it('refuse an empty JSON body with 400 BAD_REQUEST', async () => {
    start();

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/ship/send',
      headers: { 'content-type': 'application/json' },
      payload: '',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ code: 'BAD_REQUEST', message: 'The request body is not valid JSON' });
  });

  it('refuse a body over 1 MiB with 413 PAYLOAD_TOO_LARGE', async () => {
    start();

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/ship/send',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ payload: 'x'.repeat(1024 * 1024) }),
    });

    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({ code: 'PAYLOAD_TOO_LARGE', message: 'The request body is over 1 MiB' });
  });

  it('refuse a body that is not JSON by its content type with 415 UNSUPPORTED_MEDIA_TYPE', async () => {
    start();

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/ship/send',
      headers: { 'content-type': 'application/xml' },
      payload: '<send/>',
    });

    expect(response.statusCode).toBe(415);
    expect(response.json()).toEqual({ code: 'UNSUPPORTED_MEDIA_TYPE', message: 'The request body must be JSON' });
  });

  it('answer an unknown route with 404 NOT_FOUND, without echoing the path', async () => {
    start();

    const response = await server.inject({ method: 'GET', url: '/nowhere/aeolus_sk_v1_secret' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ code: 'NOT_FOUND', message: 'Nothing is served at this path' });
  });

  it('answer a known path with the wrong method as 404 NOT_FOUND too', async () => {
    start();

    const response = await server.inject({ method: 'DELETE', url: '/api/v1/ship/send' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ code: 'NOT_FOUND', message: 'Nothing is served at this path' });
  });
});
