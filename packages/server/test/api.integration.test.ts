import { createIdGenerator, type FleetId, type Scope, type ShipId } from '@aeolus-fleet/common';
import { createTRPCClient, httpBatchLink, TRPCClientError, type TRPCClient } from '@trpc/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { sha256Hasher } from '../src/adapters/crypto/secrets.js';
import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createApp } from '../src/app.js';
import type { AppRouter } from '../src/index.js';
import { createUseCases } from '../src/wiring.js';
import { FLEET_URL, OPERATOR, secretIn } from './support/core-fixtures.js';
import { createMigratedDatabase } from './support/database.js';
import { unwrap } from './support/result.js';
import { createTestClock } from './support/postgres-core.js';

// The API from HTTP to Postgres and back: scopes are checked at the door, the
// console session travels as a cookie, and health says nothing about fleets.

const newId = createIdGenerator();
const clock = createTestClock('2026-09-29T12:00:00.000Z');
const SIGN_IN_RATE_LIMIT = { limit: 5, windowMs: 60_000 };
/** Where the console runs: the fleet's own origin, as no other console origin is configured. */
const CONSOLE = new URL(FLEET_URL).origin;

let databaseUrl: string;
let database: PrismaClient;
let server: FastifyInstance;
let address: string;
let fleetId: FleetId;
let argoId: ShipId;

beforeAll(async () => {
  databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  ({ fleetId, operatorShipId: argoId } = unwrap(
    await createUseCases({ prisma: database, clock, fleetUrl: FLEET_URL }).initialiseFleet({ name: 'home fleet', ...OPERATOR }),
  ));

  server = createApp({
    databaseUrl,
    publicUrl: FLEET_URL,
    clock,
    logger: false,
    signInRateLimit: SIGN_IN_RATE_LIMIT,
  });
  address = await server.listen({ host: '127.0.0.1', port: 0 });
});

afterAll(async () => {
  await server.close();
  await database.$disconnect();
});

function client(headers: Record<string, string> = {}): TRPCClient<AppRouter> {
  return createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${address}/trpc`, headers })] });
}

async function codeOf(call: Promise<unknown>): Promise<string | undefined> {
  return (await refusalOf(call))?.code;
}

/** The tRPC error code and message a call fails with; undefined when it succeeds. */
async function refusalOf(call: Promise<unknown>): Promise<{ code: string | undefined; message: string } | undefined> {
  try {
    await call;
  } catch (error) {
    if (error instanceof TRPCClientError) {
      return { code: z.object({ code: z.string() }).safeParse(error.data).data?.code, message: error.message };
    }
    throw error;
  }
  return undefined;
}

/**
 * A ship with a valid secret, straight into the database: the agent scopes
 * unless told otherwise. Commissioning always gives the agent scopes, so a ship
 * with other scopes comes only this way.
 */
async function agentShip(scopes: Scope[] = ['messages:send', 'messages:receive']): Promise<{ shipId: ShipId; secret: string }> {
  const shipId = newId('ship');
  const secret = `aeolus_sk_v1_${newId('credential')}`;
  await database.ship.create({
    data: {
      id: shipId,
      fleetId,
      name: `agent-${shipId.slice(-6)}`,
      type: 'reviewer',
      kind: 'agent',
      scopes,
      createdAt: clock.now(),
    },
  });
  await database.credential.create({
    data: { id: newId('credential'), fleetId, shipId, secretHash: sha256Hasher.hash(secret), issuedAt: clock.now() },
  });
  return { shipId, secret };
}

/** An agent ship a session crews, straight into the database, as {@link agentShip} makes it; returns its crew token. */
async function crewedShip(scopes?: Scope[]): Promise<string> {
  const { shipId } = await agentShip(scopes);
  const crewToken = `aeolus_ct_v1_${newId('lease')}`;
  await database.lease.create({
    data: {
      id: newId('lease'),
      fleetId,
      shipId,
      location: 'DEVICE',
      crewTokenHash: sha256Hasher.hash(crewToken),
      startedAt: clock.now(),
    },
  });
  return crewToken;
}

/** Signs in from the console, unless told another origin. */
async function signIn(login: { email: string; password: string } = OPERATOR, origin = CONSOLE): Promise<Response> {
  return fetch(`${address}/trpc/console.signIn`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(login),
  });
}

function sessionCookieOf(response: Response): string {
  const [cookie] = response.headers.getSetCookie();
  return cookie?.split(';')[0] ?? '';
}

/**
 * argo, through a new console session: argo has no secret, so the operator's
 * sign-in is the only way to call as argo. A new rate-limit window first, so
 * the sign-ins of many tests never hit the limit.
 */
async function signedInArgo(): Promise<TRPCClient<AppRouter>> {
  clock.advance(SIGN_IN_RATE_LIMIT.windowMs);
  return client({ cookie: sessionCookieOf(await signIn()), origin: CONSOLE });
}

describe('the migrations', () => {
  it('are all applied', async () => {
    const applied = await database.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM _prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      ORDER BY migration_name`;

    expect(applied.map((row) => row.migration_name)).toEqual([
      expect.stringMatching(/^\d{14}_init$/),
      expect.stringMatching(/^\d{14}_fleet_argo_console_session$/),
      expect.stringMatching(/^\d{14}_operator_login$/),
      expect.stringMatching(/^\d{14}_crew_token$/),
      expect.stringMatching(/^\d{14}_send$/),
    ]);
  });
});

describe('scopes at the API', () => {
  it('refuse system.ping without a caller', async () => {
    await expect(codeOf(client().system.ping.query())).resolves.toBe('UNAUTHORIZED');
  });

  it('refuse system.ping to an agent ship, which lacks fleet:read', async () => {
    const crewToken = await crewedShip();

    await expect(codeOf(client({ authorization: `Bearer ${crewToken}` }).system.ping.query())).resolves.toBe(
      'FORBIDDEN',
    );
  });

  it('serve system.ping to a ship with fleet:read, by its crew token', async () => {
    const crewToken = await crewedShip(['fleet:read']);

    await expect(client({ authorization: `Bearer ${crewToken}` }).system.ping.query()).resolves.toEqual({
      serverTime: clock.now().toISOString(),
      fleetCount: 1,
    });
  });

  it('refuse a ship secret as the bearer: the secret works only for register', async () => {
    const { secret } = await agentShip(['fleet:read']);

    await expect(codeOf(client({ authorization: `Bearer ${secret}` }).system.ping.query())).resolves.toBe(
      'UNAUTHORIZED',
    );
  });
});

describe('the console session over HTTP', () => {
  it('signs in with a cookie that serves system.ping', async () => {
    const response = await signIn();
    const cookie = sessionCookieOf(response);

    expect(response.status).toBe(200);
    expect(cookie).toMatch(/^aeolus_session=.+/);
    await expect(client({ cookie }).system.ping.query()).resolves.toMatchObject({ fleetCount: 1 });
  });

  it('stops serving the first cookie after a second sign-in', async () => {
    const first = sessionCookieOf(await signIn());
    const second = sessionCookieOf(await signIn());

    await expect(codeOf(client({ cookie: first }).system.ping.query())).resolves.toBe('UNAUTHORIZED');
    await expect(client({ cookie: second }).system.ping.query()).resolves.toMatchObject({ fleetCount: 1 });
  });

  it('signs out through the tRPC client: the cookie stops working', async () => {
    const cookie = sessionCookieOf(await signIn());

    await client({ cookie, origin: CONSOLE }).console.signOut.mutate();

    await expect(codeOf(client({ cookie }).system.ping.query())).resolves.toBe('UNAUTHORIZED');
  });

  it('refuses a wrong email and a wrong password with the very same answer, and no cookie', async () => {
    clock.advance(60_000);

    const wrongEmail = await signIn({ email: 'stranger@example.com', password: OPERATOR.password });
    const wrongPassword = await signIn({ email: OPERATOR.email, password: 'wrong horse' });

    expect([wrongEmail.status, wrongPassword.status]).toEqual([401, 401]);
    await expect(wrongEmail.json()).resolves.toEqual(await wrongPassword.json());
    expect([...wrongEmail.headers.getSetCookie(), ...wrongPassword.headers.getSetCookie()]).toEqual([]);
  });

  it('refuses a wrong password, then rate-limits the client', async () => {
    clock.advance(60_000);
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      statuses.push((await signIn({ email: OPERATOR.email, password: 'wrong horse' })).status);
    }

    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    expect((await signIn()).status).toBe(429);
  });
});

describe('the fleet procedures at the API', () => {
  const scout = { name: 'scout', type: 'reviewer' };

  it('refuse every fleet procedure without a caller', async () => {
    const shipId = newId('ship');

    await expect(codeOf(client().fleet.commission.mutate(scout))).resolves.toBe('UNAUTHORIZED');
    await expect(codeOf(client().fleet.getStartingPrompt.mutate({ shipId }))).resolves.toBe('UNAUTHORIZED');
    await expect(codeOf(client().fleet.list.query())).resolves.toBe('UNAUTHORIZED');
  });

  it('refuse fleet.commission and fleet.getStartingPrompt to an agent ship, which lacks fleet:manage', async () => {
    const agent = client({ authorization: `Bearer ${await crewedShip()}` });

    await expect(codeOf(agent.fleet.commission.mutate({ name: 'stowaway', type: 'reviewer' }))).resolves.toBe(
      'FORBIDDEN',
    );
    await expect(codeOf(agent.fleet.getStartingPrompt.mutate({ shipId: argoId }))).resolves.toBe('FORBIDDEN');
    await expect(database.ship.count({ where: { name: 'stowaway' } })).resolves.toBe(0);
  });

  it('refuse fleet.list to an agent ship, which lacks fleet:read', async () => {
    const agent = client({ authorization: `Bearer ${await crewedShip()}` });

    await expect(codeOf(agent.fleet.list.query())).resolves.toBe('FORBIDDEN');
  });

  it('serve fleet.list to a ship with fleet:read, and refuse it fleet.commission without fleet:manage', async () => {
    const reader = client({ authorization: `Bearer ${await crewedShip(['fleet:read'])}` });

    const listed = await reader.fleet.list.query();
    expect(listed.map((ship) => ship.id)).toContain(argoId);
    await expect(codeOf(reader.fleet.commission.mutate({ name: 'stowaway', type: 'reviewer' }))).resolves.toBe(
      'FORBIDDEN',
    );
  });

  it('commission a ship as argo: listed as awaiting crew, its prompt unclaimed', async () => {
    const asArgo = await signedInArgo();
    const { shipId, prompt } = await asArgo.fleet.commission.mutate({ ...scout, note: 'reviews pull requests' });

    expect(prompt).toContain(`Fleet URL: ${FLEET_URL}`);
    expect(prompt).toContain(`Ship id: ${shipId}`);
    const listed = await asArgo.fleet.list.query();
    expect(listed.find((ship) => ship.id === shipId)).toEqual({
      id: shipId,
      name: 'scout',
      type: 'reviewer',
      status: 'awaitingCrew',
      startingPrompt: { issuedAt: clock.now().toISOString(), isClaimed: false },
      location: null,
    });
  });

  it('give a new starting prompt: the previous secret stops working, the new one registers', async () => {
    const asArgo = await signedInArgo();
    const { shipId, prompt: first } = await asArgo.fleet.commission.mutate({ name: 'lookout', type: 'reviewer' });
    clock.advance(60_000);

    const { prompt } = await asArgo.fleet.getStartingPrompt.mutate({ shipId });

    expect(secretIn(prompt)).not.toBe(secretIn(first));
    await expect(
      codeOf(client().ship.register.mutate({ shipId, secret: secretIn(first), location: { kind: 'DEVICE' } })),
    ).resolves.toBe('UNAUTHORIZED');
    const { crewToken } = await client().ship.register.mutate({
      shipId,
      secret: secretIn(prompt),
      location: { kind: 'DEVICE' },
    });
    expect(crewToken).toMatch(/^aeolus_ct_v1_./);
  });

  it('refuse a commission with a name an active ship holds', async () => {
    const asArgo = await signedInArgo();
    await asArgo.fleet.commission.mutate({ name: 'mooring', type: 'reviewer' });

    await expect(codeOf(asArgo.fleet.commission.mutate({ name: 'mooring', type: 'lookout' }))).resolves.toBe(
      'CONFLICT',
    );
  });

  it.each([
    { label: 'argo as a name', input: { name: 'argo', type: 'reviewer' }, code: 'CONFLICT' },
    { label: 'a name that is not a handle', input: { name: 'Sea Scout', type: 'reviewer' }, code: 'BAD_REQUEST' },
    {
      label: 'a note over 500 characters',
      input: { name: 'pilot', type: 'reviewer', note: 'a'.repeat(501) },
      code: 'BAD_REQUEST',
    },
  ])('refuse a commission with $label', async ({ input, code }) => {
    const asArgo = await signedInArgo();
    await expect(codeOf(asArgo.fleet.commission.mutate(input))).resolves.toBe(code);
  });

  it('refuse a starting prompt for a ship that does not exist', async () => {
    const asArgo = await signedInArgo();
    const shipId = newId('ship');

    await expect(refusalOf(asArgo.fleet.getStartingPrompt.mutate({ shipId }))).resolves.toEqual({
      code: 'NOT_FOUND',
      message: `Ship ${shipId} does not exist`,
    });
  });

  it('refuse a starting prompt for argo', async () => {
    const asArgo = await signedInArgo();
    await expect(codeOf(asArgo.fleet.getStartingPrompt.mutate({ shipId: argoId }))).resolves.toBe('FORBIDDEN');
  });

  it('never carry a secret or its hash in a list response', async () => {
    clock.advance(SIGN_IN_RATE_LIMIT.windowMs);
    const cookie = sessionCookieOf(await signIn());
    const { prompt } = await client({ cookie, origin: CONSOLE }).fleet.commission.mutate({
      name: 'harbour',
      type: 'reviewer',
    });

    const response = await fetch(`${address}/trpc/fleet.list`, { headers: { cookie } });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('harbour');
    expect(body).not.toContain(secretIn(prompt));
    expect(body).not.toContain(sha256Hasher.hash(secretIn(prompt)));
    expect(body).not.toContain('aeolus_sk_v1_');
  });

  it('never write a secret, a crew token or the password to the logs, even at trace level', async () => {
    const lines: string[] = [];
    const logged = createApp({
      databaseUrl,
      publicUrl: FLEET_URL,
      clock,
      logger: {
        level: 'trace',
        stream: {
          write: (line: string) => {
            lines.push(line);
          },
        },
      },
    });
    try {
      const url = await logged.listen({ host: '127.0.0.1', port: 0 });
      const signedIn = await fetch(`${url}/trpc/console.signIn`, {
        method: 'POST',
        headers: { origin: CONSOLE, 'content-type': 'application/json' },
        body: JSON.stringify(OPERATOR),
      });
      const asArgoThere = createTRPCClient<AppRouter>({
        links: [
          httpBatchLink({ url: `${url}/trpc`, headers: { cookie: sessionCookieOf(signedIn), origin: CONSOLE } }),
        ],
      });

      const { shipId, prompt } = await asArgoThere.fleet.commission.mutate({ name: 'logbook', type: 'reviewer' });
      const again = await asArgoThere.fleet.getStartingPrompt.mutate({ shipId });
      await asArgoThere.fleet.list.query();
      const asShipThere = (headers: Record<string, string>) =>
        createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${url}/trpc`, headers })] });
      const { crewToken } = await asShipThere({}).ship.register.mutate({
        shipId,
        secret: secretIn(again.prompt),
        location: { kind: 'DEVICE' },
      });
      await asShipThere({ authorization: `Bearer ${crewToken}` }).ship.whoami.query();
      // A refused register logs its error path too.
      await expect(
        asShipThere({}).ship.register.mutate({ shipId, secret: secretIn(again.prompt), location: { kind: 'DEVICE' } }),
      ).rejects.toThrow('logbook is crewed');
      // A refused commission logs its error path too.
      await expect(asArgoThere.fleet.commission.mutate({ name: 'logbook', type: 'reviewer' })).rejects.toThrow(
        'An active ship is already named logbook',
      );

      expect(lines.length).toBeGreaterThan(0);
      const logs = lines.join('');
      for (const secret of [secretIn(prompt), secretIn(again.prompt), OPERATOR.password, crewToken]) {
        expect(logs).not.toContain(secret);
      }
      expect(logs).not.toContain('aeolus_sk_v1_');
      expect(logs).not.toContain('aeolus_ct_v1_');
    } finally {
      await logged.close();
    }
  });
});

describe('the ship procedures at the API', () => {
  /** A ship commissioned by argo: its id and the secret from its starting prompt. */
  async function commissioned(name: string): Promise<{ shipId: ShipId; secret: string }> {
    const { shipId, prompt } = await (await signedInArgo()).fleet.commission.mutate({ name, type: 'reviewer' });
    return { shipId, secret: secretIn(prompt) };
  }

  function asShip(crewToken: string): TRPCClient<AppRouter> {
    return client({ authorization: `Bearer ${crewToken}` });
  }

  it('register a ship with the secret from its prompt: whoami answers with the crew token', async () => {
    const { shipId, secret } = await commissioned('navigator');

    const { crewToken } = await client().ship.register.mutate({ shipId, secret, location: { kind: 'CLOUD' } });

    expect(crewToken).toMatch(/^aeolus_ct_v1_./);
    await expect(asShip(crewToken).ship.whoami.query()).resolves.toEqual({
      shipId,
      fleetId,
      name: 'navigator',
      type: 'reviewer',
    });
  });

  it('register: the fleet list shows the ship crewed where its session runs, its prompt claimed', async () => {
    const { shipId, secret } = await commissioned('rigger');

    await client().ship.register.mutate({ shipId, secret, location: { kind: 'OTHER', description: 'a ci runner' } });

    const listed = await (await signedInArgo()).fleet.list.query();
    expect(listed.find((ship) => ship.id === shipId)).toMatchObject({
      status: 'crewed',
      startingPrompt: { isClaimed: true },
      location: { kind: 'OTHER', description: 'a ci runner' },
    });
  });

  it('refuse whoami with the ship secret: it works only for register', async () => {
    const { shipId, secret } = await commissioned('bosun');
    await client().ship.register.mutate({ shipId, secret, location: { kind: 'DEVICE' } });

    await expect(codeOf(asShip(secret).ship.whoami.query())).resolves.toBe('UNAUTHORIZED');
  });

  it('refuse whoami without a caller', async () => {
    await expect(codeOf(client().ship.whoami.query())).resolves.toBe('UNAUTHORIZED');
  });

  it('answer whoami for the console session: argo', async () => {
    await expect((await signedInArgo()).ship.whoami.query()).resolves.toEqual({
      shipId: argoId,
      fleetId,
      name: 'argo',
      type: 'operator',
    });
  });

  it('refuse register with a wrong secret, and say only that the ship id or secret is wrong', async () => {
    const { shipId } = await commissioned('purser');

    await expect(
      refusalOf(client().ship.register.mutate({ shipId, secret: 'aeolus_sk_v1_wrong', location: { kind: 'DEVICE' } })),
    ).resolves.toEqual({ code: 'UNAUTHORIZED', message: 'Wrong ship id or secret' });
  });

  it('refuse a second register while the ship is crewed', async () => {
    const { shipId, secret } = await commissioned('helmsman');
    await client().ship.register.mutate({ shipId, secret, location: { kind: 'DEVICE' } });

    await expect(
      refusalOf(client().ship.register.mutate({ shipId, secret, location: { kind: 'SERVER' } })),
    ).resolves.toEqual({
      code: 'CONFLICT',
      message: 'helmsman is crewed: a session claims a ship only while it awaits crew',
    });
  });

  it('refuse register with an OTHER location without its description', async () => {
    const { shipId, secret } = await commissioned('cook');

    await expect(
      codeOf(client().ship.register.mutate({ shipId, secret, location: { kind: 'OTHER', description: ' ' } })),
    ).resolves.toBe('BAD_REQUEST');
  });
});

describe('state-changing console calls from a foreign origin', () => {
  const FOREIGN = 'https://sibling.fleet.example.com';

  it('refuse a commission with the session cookie from a foreign origin, and commission nothing', async () => {
    clock.advance(SIGN_IN_RATE_LIMIT.windowMs);
    const cookie = sessionCookieOf(await signIn());

    await expect(
      refusalOf(client({ cookie, origin: FOREIGN }).fleet.commission.mutate({ name: 'forged', type: 'reviewer' })),
    ).resolves.toEqual({ code: 'FORBIDDEN', message: "A console call that changes state must come from the console's origin" });
    await expect(database.ship.count({ where: { name: 'forged' } })).resolves.toBe(0);
  });

  it('refuse a commission with the session cookie and no Origin', async () => {
    clock.advance(SIGN_IN_RATE_LIMIT.windowMs);
    const cookie = sessionCookieOf(await signIn());

    await expect(codeOf(client({ cookie }).fleet.commission.mutate({ name: 'forged', type: 'reviewer' }))).resolves.toBe(
      'FORBIDDEN',
    );
  });

  it('refuse a sign-in from a foreign origin, with no cookie', async () => {
    clock.advance(SIGN_IN_RATE_LIMIT.windowMs);

    const response = await signIn(OPERATOR, FOREIGN);

    expect(response.status).toBe(403);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it('refuse a sign-out from a foreign origin: the session stays', async () => {
    clock.advance(SIGN_IN_RATE_LIMIT.windowMs);
    const cookie = sessionCookieOf(await signIn());

    await expect(codeOf(client({ cookie, origin: FOREIGN }).console.signOut.mutate())).resolves.toBe('FORBIDDEN');
    const listed = await client({ cookie }).fleet.list.query();
    expect(listed.map((ship) => ship.id)).toContain(argoId);
  });
});

describe('a console on another origin under the configured domain', () => {
  const CONSOLE_ORIGIN = 'https://console.fleet.example.com';
  let acrossHosts: FastifyInstance;
  let serverUrl: string;

  beforeAll(async () => {
    acrossHosts = createApp({
      databaseUrl,
      publicUrl: FLEET_URL,
      clock,
      logger: false,
      cookieDomain: 'fleet.example.com',
      consoleOrigin: CONSOLE_ORIGIN,
    });
    serverUrl = await acrossHosts.listen({ host: '127.0.0.1', port: 0 });
  });

  afterAll(async () => {
    await acrossHosts.close();
  });

  it('signs in with credentials across origins, gets a cookie for the whole domain, and calls with it', async () => {
    const preflight = await fetch(`${serverUrl}/trpc/console.signIn`, {
      method: 'OPTIONS',
      headers: {
        origin: CONSOLE_ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    const signedIn = await fetch(`${serverUrl}/trpc/console.signIn`, {
      method: 'POST',
      headers: { origin: CONSOLE_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify(OPERATOR),
    });
    const [setCookie = ''] = signedIn.headers.getSetCookie();
    const listed = await fetch(`${serverUrl}/trpc/fleet.list`, {
      headers: { origin: CONSOLE_ORIGIN, cookie: setCookie.split(';')[0] ?? '' },
    });

    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(CONSOLE_ORIGIN);
    expect(preflight.headers.get('access-control-allow-credentials')).toBe('true');
    expect(signedIn.status).toBe(200);
    expect(signedIn.headers.get('access-control-allow-origin')).toBe(CONSOLE_ORIGIN);
    expect(signedIn.headers.get('access-control-allow-credentials')).toBe('true');
    expect(setCookie).toMatch(/; Domain=fleet\.example\.com; Path=\/; HttpOnly; Secure; SameSite=Strict$/);
    expect(listed.status).toBe(200);
    expect(listed.headers.get('access-control-allow-origin')).toBe(CONSOLE_ORIGIN);
  });

  it('lets no other origin read an answer', async () => {
    const response = await fetch(`${serverUrl}/trpc/fleet.list`, { headers: { origin: 'https://elsewhere.example.com' } });

    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('/health', () => {
  it('reports server and database up, and nothing about fleets', async () => {
    const response = await fetch(`${address}/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ server: 'up', database: 'up' });
  });

  it('reports 503 when Postgres is unreachable', async () => {
    const unreachable = createApp({
      databaseUrl: 'postgresql://aeolus:aeolus@127.0.0.1:1/aeolus',
      publicUrl: FLEET_URL,
      logger: false,
    });
    try {
      const response = await unreachable.inject({ method: 'GET', url: '/health' });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ server: 'up', database: 'down' });
    } finally {
      await unreachable.close();
    }
  });
});
