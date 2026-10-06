import { createIdGenerator, idSchema, SCOPES, type FleetId, type Scope, type SendInput, type ShipId } from '@aeolus-fleet/common';
import { createTRPCClient, httpBatchLink, TRPCClientError, type TRPCClient } from '@trpc/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { sha256Hasher } from '../src/adapters/crypto/secrets.js';
import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createApp } from '../src/app.js';
import type { AppRouter } from '../src/index.js';
import { appRouter } from '../src/adapters/trpc/router.js';
import { createUseCases } from '../src/wiring.js';
import { FLEET_MCP_URL, FLEET_URL, OPERATOR, secretIn } from './support/core-fixtures.js';
import { createMigratedDatabase } from './support/database.js';
import { unwrap } from './support/result.js';
import { createTestClock } from './support/postgres-core.js';
import { newKey } from './support/keys.js';

// The API from HTTP to Postgres and back: scopes are checked at the door, the
// console session travels as a cookie, and health says nothing about fleets.

const newId = createIdGenerator();
const clock = createTestClock('2026-09-29T12:00:00.000Z');
const SIGN_IN_RATE_LIMIT = { limit: 5, windowMs: 60_000 };
/** How long a receive waits on an empty inbox at this server: short, so an empty receive costs little. */
const RECEIVE_WAIT_MS = 500;
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
    await createUseCases({ prisma: database, clock }).initialiseFleet({ name: 'home fleet', ...OPERATOR }),
  ));

  server = createApp({
    databaseUrl,
    publicUrl: FLEET_URL,
    clock,
    logger: false,
    signInRateLimit: SIGN_IN_RATE_LIMIT,
    receiveWaitMs: RECEIVE_WAIT_MS,
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
      expect.stringMatching(/^\d{14}_receive$/),
      expect.stringMatching(/^\d{14}_event_seq$/),
      expect.stringMatching(/^\d{14}_console_session_end_reason$/),
      expect.stringMatching(/^\d{14}_account_theme_session_device$/),
      expect.stringMatching(/^\d{14}_lease_last_seen$/),
      expect.stringMatching(/^\d{14}_lease_report$/),
      expect.stringMatching(/^\d{14}_commission_key$/),
      expect.stringMatching(/^\d{14}_message_model$/),
      expect.stringMatching(/^\d{14}_lease_harness$/),
      expect.stringMatching(/^\d{14}_operator_without_password$/),
      expect.stringMatching(/^\d{14}_installation_requests$/),
      expect.stringMatching(/^\d{14}_events_deleted_with_their_fleet$/),
      expect.stringMatching(/^\d{14}_sign_in_tickets$/),
      expect.stringMatching(/^\d{14}_fleet_limits$/),
      expect.stringMatching(/^\d{14}_installation_settings$/),
      expect.stringMatching(/^\d{14}_viewer_ship$/),
      expect.stringMatching(/^\d{14}_viewer_sessions$/),
      expect.stringMatching(/^\d{14}_notices$/),
      expect.stringMatching(/^\d{14}_guide$/),
      expect.stringMatching(/^\d{14}_fleet_crew_scope$/),
      expect.stringMatching(/^\d{14}_lease_report_details$/),
      expect.stringMatching(/^\d{14}_crew_requests$/),
      expect.stringMatching(/^\d{14}_crew_scopes$/),
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

    await expect(codeOf(client().fleet.commission.mutate({ ...scout, idempotencyKey: newKey() }))).resolves.toBe('UNAUTHORIZED');
    await expect(codeOf(client().fleet.getStartingPrompt.mutate({ shipId }))).resolves.toBe('UNAUTHORIZED');
    await expect(codeOf(client().fleet.list.query())).resolves.toBe('UNAUTHORIZED');
  });

  it('refuse fleet.commission and fleet.getStartingPrompt to an agent ship, which lacks fleet:manage', async () => {
    const agent = client({ authorization: `Bearer ${await crewedShip()}` });

    await expect(codeOf(agent.fleet.commission.mutate({ idempotencyKey: newKey(), name: 'stowaway', type: 'reviewer' }))).resolves.toBe(
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
    await expect(codeOf(reader.fleet.commission.mutate({ idempotencyKey: newKey(), name: 'stowaway', type: 'reviewer' }))).resolves.toBe(
      'FORBIDDEN',
    );
  });

  it('serve a ship with fleet:crew one ship, its starting prompt and its release', async () => {
    const trierarch = client({ authorization: `Bearer ${await crewedShip(['messages:send', 'messages:receive', 'fleet:crew'])}` });
    const awaiting = await agentShip();
    const { shipId: crewed } = await agentShip();
    await database.lease.create({
      data: { id: newId('lease'), fleetId, shipId: crewed, location: 'DEVICE', crewTokenHash: sha256Hasher.hash(newId('lease')), startedAt: clock.now() },
    });

    const read = await trierarch.fleet.ship.query({ shipId: awaiting.shipId });
    const prompt = await trierarch.fleet.getStartingPrompt.mutate({ shipId: awaiting.shipId });
    await trierarch.fleet.release.mutate({ shipId: crewed });

    expect(read.id).toBe(awaiting.shipId);
    expect(prompt.prompt).toContain(`Ship id: ${awaiting.shipId}`);
    await expect(database.lease.count({ where: { shipId: crewed, endedAt: null } })).resolves.toBe(0);
  });

  it('refuse every other fleet procedure to a ship with only fleet:crew', async () => {
    const crewToken = await crewedShip(['messages:send', 'messages:receive', 'fleet:crew']);
    const others = Object.entries(appRouter.fleet).filter(([name]) => !['ship', 'getStartingPrompt', 'release'].includes(name));
    // argo's inbox takes the message scopes every agent ship holds, and refuses any ship but argo once its input parses.
    const deliveryId = newId('delivery');
    const inputs: Record<string, unknown> = {
      markRead: { deliveryId, isRead: true },
      markDone: { deliveryId },
      reply: { deliveryId, payload: 'hi', idempotencyKey: newKey() },
    };

    const codes = await Promise.all(
      others.map(async ([name, procedure]) => {
        const isQuery = procedure._def.type !== 'mutation';
        const input = JSON.stringify(inputs[name] ?? {});
        const url = `${address}/trpc/fleet.${name}${isQuery ? `?input=${encodeURIComponent(input)}` : ''}`;
        const response = await fetch(url, {
          method: isQuery ? 'GET' : 'POST',
          headers: { authorization: `Bearer ${crewToken}`, 'content-type': 'application/json' },
          ...(!isQuery && { body: input }),
        });
        // A subscription answers as server-sent events, its refusal among them; the others as JSON.
        return [name, /"code":"([A-Z_]+)"/.exec(await response.text())?.[1]];
      }),
    );

    expect(others.length).toBeGreaterThan(0);
    expect(Object.fromEntries(codes)).toEqual(Object.fromEntries(others.map(([name]) => [name, 'FORBIDDEN'])));
  });

  it('commission a ship as argo: listed as awaiting crew, its prompt unclaimed', async () => {
    const asArgo = await signedInArgo();
    const { shipId, prompt } = await asArgo.fleet.commission.mutate({ idempotencyKey: newKey(), ...scout, note: 'reviews pull requests' });

    expect(prompt).toContain(`Fleet MCP URL: ${FLEET_MCP_URL}`);
    expect(prompt).toContain(`Ship id: ${shipId}`);
    const listed = await asArgo.fleet.list.query();
    expect(listed.find((ship) => ship.id === shipId)).toEqual({
      id: shipId,
      name: 'scout',
      type: 'reviewer',
      kind: 'agent',
      status: 'awaitingCrew',
      startingPrompt: { issuedAt: clock.now().toISOString(), isClaimed: false },
      location: null,
      lastSeenAt: null,
      ping: null,
      scopes: ['messages:send', 'messages:receive'],
      report: null,
      crewRequest: null,
      harness: null,
      model: null,
      awaitingCrewSince: clock.now().toISOString(),
      retiredAt: null,
    });
  });

  it('give a new starting prompt: the previous secret stops working, the new one registers', async () => {
    const asArgo = await signedInArgo();
    const { shipId, prompt: first } = await asArgo.fleet.commission.mutate({ idempotencyKey: newKey(), name: 'lookout', type: 'reviewer' });
    clock.advance(60_000);

    const { prompt } = await asArgo.fleet.getStartingPrompt.mutate({ shipId });

    expect(secretIn(prompt)).not.toBe(secretIn(first));
    await expect(
      codeOf(client().ship.register.mutate({ shipId, secret: secretIn(first), location: { kind: 'DEVICE' }, harness: 'claude-code' })),
    ).resolves.toBe('UNAUTHORIZED');
    const { crewToken } = await client().ship.register.mutate({
      shipId,
      secret: secretIn(prompt),
      location: { kind: 'DEVICE' }, harness: 'claude-code',
    });
    expect(crewToken).toMatch(/^aeolus_ct_v1_./);
  });

  it('refuse a commission with a name an active ship holds', async () => {
    const asArgo = await signedInArgo();
    await asArgo.fleet.commission.mutate({ idempotencyKey: newKey(), name: 'mooring', type: 'reviewer' });

    await expect(codeOf(asArgo.fleet.commission.mutate({ idempotencyKey: newKey(), name: 'mooring', type: 'lookout' }))).resolves.toBe(
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
    await expect(codeOf(asArgo.fleet.commission.mutate({ idempotencyKey: newKey(), ...input }))).resolves.toBe(code);
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
    const { prompt } = await client({ cookie, origin: CONSOLE }).fleet.commission.mutate({ idempotencyKey: newKey(),
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

  it('never write a secret, a crew token, the password or a payload to the logs, even at trace level', async () => {
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

      const { shipId, prompt } = await asArgoThere.fleet.commission.mutate({ idempotencyKey: newKey(), name: 'logbook', type: 'reviewer' });
      const again = await asArgoThere.fleet.getStartingPrompt.mutate({ shipId });
      await asArgoThere.fleet.list.query();
      const asShipThere = (headers: Record<string, string>) =>
        createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${url}/trpc`, headers })] });
      const { crewToken } = await asShipThere({}).ship.register.mutate({
        shipId,
        secret: secretIn(again.prompt),
        location: { kind: 'DEVICE' }, harness: 'claude-code',
      });
      await asShipThere({ authorization: `Bearer ${crewToken}` }).ship.whoami.query();
      await asShipThere({ authorization: `Bearer ${crewToken}` }).ship.send.mutate({
        selector: { kind: 'ship', name: 'argo' },
        payload: 'the logbook payload',
        contentType: 'text/plain',
        model: 'claude-opus-5-5',
        idempotencyKey: 'logbook-1',
      });
      // A refused register logs its error path too.
      await expect(
        asShipThere({}).ship.register.mutate({ shipId, secret: secretIn(again.prompt), location: { kind: 'DEVICE' }, harness: 'claude-code' }),
      ).rejects.toThrow('logbook is crewed');
      // A refused commission logs its error path too.
      await expect(asArgoThere.fleet.commission.mutate({ idempotencyKey: newKey(), name: 'logbook', type: 'reviewer' })).rejects.toThrow(
        'An active ship is already named logbook',
      );

      expect(lines.length).toBeGreaterThan(0);
      const logs = lines.join('');
      for (const secret of [secretIn(prompt), secretIn(again.prompt), OPERATOR.password, crewToken]) {
        expect(logs).not.toContain(secret);
      }
      expect(logs).not.toContain('aeolus_sk_v1_');
      expect(logs).not.toContain('aeolus_ct_v1_');
      expect(logs).not.toContain('the logbook payload');
    } finally {
      await logged.close();
    }
  });
});

describe('the ship procedures at the API', () => {
  /** A ship commissioned by argo: its id and the secret from its starting prompt. */
  async function commissioned(name: string): Promise<{ shipId: ShipId; secret: string }> {
    const { shipId, prompt } = await (await signedInArgo()).fleet.commission.mutate({ idempotencyKey: newKey(), name, type: 'reviewer' });
    return { shipId, secret: secretIn(prompt) };
  }

  function asShip(crewToken: string): TRPCClient<AppRouter> {
    return client({ authorization: `Bearer ${crewToken}` });
  }

  it('register a ship with the secret from its prompt: whoami answers with the crew token', async () => {
    const { shipId, secret } = await commissioned('navigator');

    const { crewToken } = await client().ship.register.mutate({ shipId, secret, location: { kind: 'CLOUD' }, harness: 'claude-code' });

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

    await client().ship.register.mutate({ shipId, secret, location: { kind: 'OTHER', description: 'a ci runner' }, harness: 'claude-code' });

    const listed = await (await signedInArgo()).fleet.list.query();
    expect(listed.find((ship) => ship.id === shipId)).toMatchObject({
      status: 'crewed',
      startingPrompt: { isClaimed: true },
      location: { kind: 'OTHER', description: 'a ci runner' },
    });
  });

  it('refuse whoami with the ship secret: it works only for register', async () => {
    const { shipId, secret } = await commissioned('bosun');
    await client().ship.register.mutate({ shipId, secret, location: { kind: 'DEVICE' }, harness: 'claude-code' });

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
      refusalOf(client().ship.register.mutate({ shipId, secret: 'aeolus_sk_v1_wrong', location: { kind: 'DEVICE' }, harness: 'claude-code' })),
    ).resolves.toEqual({ code: 'UNAUTHORIZED', message: 'Wrong ship id or secret' });
  });

  it('refuse a second register while the ship is crewed', async () => {
    const { shipId, secret } = await commissioned('helmsman');
    await client().ship.register.mutate({ shipId, secret, location: { kind: 'DEVICE' }, harness: 'claude-code' });

    await expect(
      refusalOf(client().ship.register.mutate({ shipId, secret, location: { kind: 'SERVER' }, harness: 'claude-code' })),
    ).resolves.toEqual({
      code: 'CONFLICT',
      message: 'helmsman is crewed: a session claims a ship only while it awaits crew',
    });
  });

  it('refuse register with an OTHER location without its description', async () => {
    const { shipId, secret } = await commissioned('cook');

    await expect(
      codeOf(client().ship.register.mutate({ shipId, secret, location: { kind: 'OTHER', description: ' ' }, harness: 'claude-code' })),
    ).resolves.toBe('BAD_REQUEST');
  });
});

describe('ship.send at the API', () => {
  /** A ship commissioned by argo and claimed through register: its id and crew token. */
  async function crewedByRegister(name: string): Promise<{ shipId: ShipId; crewToken: string }> {
    const { shipId, prompt } = await (await signedInArgo()).fleet.commission.mutate({ idempotencyKey: newKey(), name, type: 'courier' });
    const { crewToken } = await client().ship.register.mutate({
      shipId,
      secret: secretIn(prompt),
      location: { kind: 'CLOUD' }, harness: 'claude-code',
    });
    return { shipId, crewToken };
  }

  /** A plain-text message to argo, with a key of its own unless told otherwise. */
  function toArgo(overrides: Partial<SendInput> = {}): SendInput {
    return {
      selector: { kind: 'ship', name: 'argo' },
      payload: 'Review https://github.com/ThomasHendrickx/aeolus-fleet/pull/22',
      contentType: 'text/plain',
      model: 'claude-opus-5-5',
      idempotencyKey: `key-${newId('message')}`,
      ...overrides,
    };
  }

  it('sends with a crew token: the message is stored from that ship, and its id comes back', async () => {
    const { shipId, crewToken } = await crewedByRegister('dispatch');

    const { messageId } = await client({ authorization: `Bearer ${crewToken}` }).ship.send.mutate(toArgo());

    expect(messageId).toMatch(/^msg_/);
    await expect(database.message.findUniqueOrThrow({ where: { id: messageId } })).resolves.toMatchObject({
      senderShipId: shipId,
      selectorKind: 'ship',
      selectorShipId: argoId,
    });
    await expect(database.delivery.findFirstOrThrow({ where: { messageId } })).resolves.toMatchObject({
      recipientShipId: argoId,
      state: 'pending',
    });
  });

  it('sends as argo from the console session', async () => {
    const { shipId } = await crewedByRegister('relay');

    const { messageId } = await (await signedInArgo()).ship.send.mutate(
      toArgo({ selector: { kind: 'ship', shipId }, model: undefined }),
    );

    await expect(database.message.findUniqueOrThrow({ where: { id: messageId } })).resolves.toMatchObject({
      senderShipId: argoId,
      selectorShipId: shipId,
    });
  });

  it('returns the original id for a repeat of the idempotency key', async () => {
    const { crewToken } = await crewedByRegister('echo');
    const asShip = client({ authorization: `Bearer ${crewToken}` });
    const input = toArgo();

    const first = await asShip.ship.send.mutate(input);
    const repeated = await asShip.ship.send.mutate(input);

    expect(repeated).toEqual(first);
    await expect(database.message.count({ where: { idempotencyKey: input.idempotencyKey } })).resolves.toBe(1);
  });

  it('takes any media type as the content type, and refuses what is not one with BAD_REQUEST', async () => {
    const asShip = client({ authorization: `Bearer ${await crewedShip()}` });

    const { messageId } = await asShip.ship.send.mutate(toArgo({ contentType: 'text/markdown; charset=utf-8' }));

    await expect(database.message.findUniqueOrThrow({ where: { id: messageId } })).resolves.toMatchObject({
      contentType: 'text/markdown; charset=utf-8',
    });
    await expect(codeOf(asShip.ship.send.mutate(toArgo({ contentType: 'markdown' })))).resolves.toBe('BAD_REQUEST');
  });

  it('stores text/plain when the ship leaves the content type out', async () => {
    const asShip = client({ authorization: `Bearer ${await crewedShip()}` });
    const { selector, payload, idempotencyKey } = toArgo();

    const { messageId } = await asShip.ship.send.mutate({ selector, payload, model: 'claude-opus-5-5', idempotencyKey });

    await expect(database.message.findUniqueOrThrow({ where: { id: messageId } })).resolves.toMatchObject({
      contentType: 'text/plain',
    });
  });

  it.each([
    { field: 'payload', value: 'review\u0000' },
    { field: 'idempotencyKey', value: 'key\u0000' },
    { field: 'contentType', value: 'text/plain\u0000' },
  ])('refuses the character U+0000 in $field with BAD_REQUEST and a clear message, never a server failure', async ({
    field,
    value,
  }) => {
    const asShip = client({ authorization: `Bearer ${await crewedShip()}` });

    await expect(refusalOf(asShip.ship.send.mutate({ ...toArgo(), [field]: value }))).resolves.toEqual({
      code: 'BAD_REQUEST',
      message: `The input field ${field} cannot hold the character U+0000 (NUL)`,
    });
  });

  it('refuses the same key with another request with CONFLICT', async () => {
    const asShip = client({ authorization: `Bearer ${await crewedShip()}` });
    const input = toArgo();
    await asShip.ship.send.mutate(input);

    await expect(refusalOf(asShip.ship.send.mutate({ ...input, payload: 'something else' }))).resolves.toEqual({
      code: 'CONFLICT',
      message: 'This idempotency key was already used for another message: send a new message with a new key',
    });
  });

  it('refuses a ship without messages:send, and stores nothing', async () => {
    const reader = client({ authorization: `Bearer ${await crewedShip(['fleet:read'])}` });
    const input = toArgo();

    await expect(refusalOf(reader.ship.send.mutate(input))).resolves.toEqual({
      code: 'FORBIDDEN',
      message: 'This call needs the messages:send scope',
    });
    await expect(database.message.count({ where: { idempotencyKey: input.idempotencyKey } })).resolves.toBe(0);
  });

  it('refuses a send without a caller', async () => {
    await expect(codeOf(client().ship.send.mutate(toArgo()))).resolves.toBe('UNAUTHORIZED');
  });

  it('refuses a send with the session cookie from a foreign origin', async () => {
    clock.advance(SIGN_IN_RATE_LIMIT.windowMs);
    const cookie = sessionCookieOf(await signIn());

    await expect(
      codeOf(client({ cookie, origin: 'https://sibling.fleet.example.com' }).ship.send.mutate(toArgo())),
    ).resolves.toBe('FORBIDDEN');
  });

  it('refuses a selector that resolves to no ship, and a reply to no message, with NOT_FOUND', async () => {
    const asShip = client({ authorization: `Bearer ${await crewedShip()}` });
    const inReplyTo = newId('message');

    await expect(refusalOf(asShip.ship.send.mutate(toArgo({ selector: { kind: 'ship', name: 'nobody' } })))).resolves.toEqual({
      code: 'NOT_FOUND',
      message: 'No active ship is named nobody',
    });
    await expect(refusalOf(asShip.ship.send.mutate(toArgo({ selector: { kind: 'type', type: 'nobody' } })))).resolves.toEqual({
      code: 'NOT_FOUND',
      message: 'No active ship has the type nobody',
    });
    await expect(refusalOf(asShip.ship.send.mutate(toArgo({ inReplyTo })))).resolves.toEqual({
      code: 'NOT_FOUND',
      message: `Message ${inReplyTo} does not exist: a reply names a message of the fleet`,
    });
  });

  it('accepts a payload of exactly 64 KB, and refuses one byte more with BAD_REQUEST, storing nothing', async () => {
    const asShip = client({ authorization: `Bearer ${await crewedShip()}` });
    const atTheLimit = toArgo({ payload: 'é'.repeat(32_768) });
    const overTheLimit = toArgo({ payload: `${'é'.repeat(32_768)}a` });

    const { messageId } = await asShip.ship.send.mutate(atTheLimit);

    await expect(database.message.findUniqueOrThrow({ where: { id: messageId } })).resolves.toMatchObject({
      payload: atTheLimit.payload,
    });
    await expect(codeOf(asShip.ship.send.mutate(overTheLimit))).resolves.toBe('BAD_REQUEST');
    await expect(
      database.message.count({ where: { idempotencyKey: overTheLimit.idempotencyKey } }),
    ).resolves.toBe(0);
  });

  it('answers a refused send without a stack trace', async () => {
    const response = await fetch(`${address}/trpc/ship.send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await crewedShip()}`, 'content-type': 'application/json' },
      body: JSON.stringify(toArgo({ selector: { kind: 'ship', name: 'nobody' } })),
    });
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(body).toContain('No active ship is named nobody');
    expect(body).not.toContain('"stack"');
    expect(body).not.toMatch(/\s{2,}at \S/);
  });
});

describe('ship.receive and ship.ack at the API', () => {
  /** A ship commissioned by argo and claimed through register: its id and a client calling with its crew token. */
  async function crewed(name: string): Promise<{ shipId: ShipId; asShip: TRPCClient<AppRouter> }> {
    const { shipId, prompt } = await (await signedInArgo()).fleet.commission.mutate({ idempotencyKey: newKey(), name, type: 'lookout' });
    const { crewToken } = await client().ship.register.mutate({
      shipId,
      secret: secretIn(prompt),
      location: { kind: 'SERVER' }, harness: 'claude-code',
    });
    return { shipId, asShip: client({ authorization: `Bearer ${crewToken}` }) };
  }

  /** A plain-text message from one ship to another by name, with a key of its own. */
  function toShipNamed(name: string): SendInput {
    return {
      selector: { kind: 'ship', name },
      payload: 'Review https://github.com/ThomasHendrickx/aeolus-fleet/pull/25',
      contentType: 'text/plain',
      model: 'claude-opus-5-5',
      idempotencyKey: `key-${newId('message')}`,
    };
  }

  it('sends from one ship, receives and acknowledges on another, with crew tokens', async () => {
    const sender = await crewed('tender');
    const receiver = await crewed('skiff');
    const { messageId } = await sender.asShip.ship.send.mutate(toShipNamed('skiff'));

    const { deliveries } = await receiver.asShip.ship.receive.mutate({ max: 5 });

    const deliveryId = idSchema('delivery').parse(deliveries[0]?.deliveryId);
    expect(deliveries).toEqual([
      {
        deliveryId,
        messageId,
        senderShipId: sender.shipId,
        senderName: 'tender',
        senderType: 'lookout',
        recipient: { kind: 'ship', shipId: receiver.shipId },
        payload: 'Review https://github.com/ThomasHendrickx/aeolus-fleet/pull/25',
        contentType: 'text/plain',
        model: 'claude-opus-5-5',
        inReplyTo: null,
        sentAt: clock.now().toISOString(),
        attempts: 1,
      },
    ]);
    await expect(receiver.asShip.ship.ack.mutate({ deliveryId })).resolves.toEqual({});
    await expect(database.delivery.findUniqueOrThrow({ where: { id: deliveryId } })).resolves.toMatchObject({
      state: 'acknowledged',
      claimedByShipId: receiver.shipId,
    });
    await expect(receiver.asShip.ship.ack.mutate({ deliveryId })).resolves.toEqual({});
  });

  it('receives one delivery when the ship does not say how many', async () => {
    const sender = await crewed('dinghy');
    const receiver = await crewed('cutter');
    await sender.asShip.ship.send.mutate(toShipNamed('cutter'));
    await sender.asShip.ship.send.mutate(toShipNamed('cutter'));

    await expect(receiver.asShip.ship.receive.mutate()).resolves.toMatchObject({ deliveries: [{ attempts: 1 }] });
  });

  it('answers an empty inbox with no deliveries once the wait ends', async () => {
    const { asShip } = await crewed('ketch');

    await expect(asShip.ship.receive.mutate({})).resolves.toEqual({ deliveries: [] });
  });

  it('refuses a max out of bounds with BAD_REQUEST', async () => {
    const { asShip } = await crewed('sloop');

    await expect(codeOf(asShip.ship.receive.mutate({ max: 11 }))).resolves.toBe('BAD_REQUEST');
    await expect(codeOf(asShip.ship.receive.mutate({ max: 0 }))).resolves.toBe('BAD_REQUEST');
  });

  it('refuses receive and ack without a caller', async () => {
    await expect(codeOf(client().ship.receive.mutate({}))).resolves.toBe('UNAUTHORIZED');
    await expect(codeOf(client().ship.ack.mutate({ deliveryId: newId('delivery') }))).resolves.toBe('UNAUTHORIZED');
  });

  it("refuses receive and ack with the console session: they take a crew token, and argo's inbox comes later", async () => {
    const asArgo = await signedInArgo();

    await expect(refusalOf(asArgo.ship.receive.mutate({}))).resolves.toEqual({
      code: 'UNAUTHORIZED',
      message: 'Call with the crew token register gave you',
    });
    await expect(codeOf(asArgo.ship.ack.mutate({ deliveryId: newId('delivery') }))).resolves.toBe('UNAUTHORIZED');
  });

  it('refuses a ship without messages:receive', async () => {
    const sender = client({ authorization: `Bearer ${await crewedShip(['messages:send'])}` });

    await expect(refusalOf(sender.ship.receive.mutate({}))).resolves.toEqual({
      code: 'FORBIDDEN',
      message: 'This call needs the messages:receive scope',
    });
    await expect(codeOf(sender.ship.ack.mutate({ deliveryId: newId('delivery') }))).resolves.toBe('FORBIDDEN');
  });

  it('refuses an ack of an unknown delivery, of one not in flight and of one another ship holds', async () => {
    const sender = await crewed('yawl');
    const receiver = await crewed('schooner');
    const other = await crewed('brig');
    await sender.asShip.ship.send.mutate(toShipNamed('schooner'));
    const { deliveries } = await receiver.asShip.ship.receive.mutate({});
    const held = idSchema('delivery').parse(deliveries[0]?.deliveryId);
    const { messageId } = await sender.asShip.ship.send.mutate(toShipNamed('schooner'));
    const pending = idSchema('delivery').parse((await database.delivery.findFirstOrThrow({ where: { messageId } })).id);

    await expect(codeOf(receiver.asShip.ship.ack.mutate({ deliveryId: newId('delivery') }))).resolves.toBe('NOT_FOUND');
    await expect(codeOf(receiver.asShip.ship.ack.mutate({ deliveryId: pending }))).resolves.toBe('CONFLICT');
    await expect(codeOf(other.asShip.ship.ack.mutate({ deliveryId: held }))).resolves.toBe('FORBIDDEN');
  });
});

describe('fleet.release and ship.deregister at the API', () => {
  /** A ship commissioned by argo and claimed through register: its id, secret, crew token and a client calling with it. */
  async function crewed(
    name: string,
  ): Promise<{ shipId: ShipId; secret: string; crewToken: string; asShip: TRPCClient<AppRouter> }> {
    const { shipId, prompt } = await (await signedInArgo()).fleet.commission.mutate({ idempotencyKey: newKey(), name, type: 'rower' });
    const secret = secretIn(prompt);
    const { crewToken } = await client().ship.register.mutate({ shipId, secret, location: { kind: 'CLOUD' }, harness: 'claude-code' });
    return { shipId, secret, crewToken, asShip: client({ authorization: `Bearer ${crewToken}` }) };
  }

  /** Every ship call the old crew token might still try, each with the code it gets. */
  async function codesOfEveryShipCall(asShip: TRPCClient<AppRouter>, shipId: ShipId): Promise<(string | undefined)[]> {
    return Promise.all([
      codeOf(asShip.ship.whoami.query()),
      codeOf(
        asShip.ship.send.mutate({
          selector: { kind: 'ship', shipId },
          payload: 'still here?',
          contentType: 'text/plain',
          model: 'claude-opus-5-5',
          idempotencyKey: `key-${newId('message')}`,
        }),
      ),
      codeOf(asShip.ship.receive.mutate({})),
      codeOf(asShip.ship.ack.mutate({ deliveryId: newId('delivery') })),
      codeOf(asShip.ship.deregister.mutate()),
    ]);
  }

  const EVERY_CALL_REFUSED = ['UNAUTHORIZED', 'UNAUTHORIZED', 'UNAUTHORIZED', 'UNAUTHORIZED', 'UNAUTHORIZED'];

  it('release a crewed ship as argo: the old crew token fails on every call, the old secret on register', async () => {
    const { shipId, secret, asShip } = await crewed('longboat');
    const asArgo = await signedInArgo();

    await expect(asArgo.fleet.release.mutate({ shipId })).resolves.toEqual({});

    await expect(codesOfEveryShipCall(asShip, shipId)).resolves.toEqual(EVERY_CALL_REFUSED);
    await expect(
      refusalOf(client().ship.register.mutate({ shipId, secret, location: { kind: 'CLOUD' }, harness: 'claude-code' })),
    ).resolves.toEqual({ code: 'UNAUTHORIZED', message: 'Wrong ship id or secret' });
    const listed = await asArgo.fleet.list.query();
    expect(listed.find((ship) => ship.id === shipId)).toMatchObject({ status: 'awaitingCrew', startingPrompt: null });
  });

  it('deregister with the crew token: the old crew token fails on every call, the old secret on register', async () => {
    const { shipId, secret, asShip } = await crewed('gig');

    await expect(asShip.ship.deregister.mutate()).resolves.toEqual({});

    await expect(codesOfEveryShipCall(asShip, shipId)).resolves.toEqual(EVERY_CALL_REFUSED);
    await expect(
      codeOf(client().ship.register.mutate({ shipId, secret, location: { kind: 'CLOUD' }, harness: 'claude-code' })),
    ).resolves.toBe('UNAUTHORIZED');
    const listed = await (await signedInArgo()).fleet.list.query();
    expect(listed.find((ship) => ship.id === shipId)).toMatchObject({ status: 'awaitingCrew', startingPrompt: null });
  });

  it('hand the delivery the old crew held in flight to the next crew, which registers with a new prompt', async () => {
    const { shipId, asShip } = await crewed('pinnace');
    const asArgo = await signedInArgo();
    await asArgo.ship.send.mutate({
      selector: { kind: 'ship', shipId },
      payload: 'Review https://github.com/ThomasHendrickx/aeolus-fleet/pull/28',
      contentType: 'text/plain',
      idempotencyKey: `key-${newId('message')}`,
    });
    const { deliveries } = await asShip.ship.receive.mutate({});
    const deliveryId = idSchema('delivery').parse(deliveries[0]?.deliveryId);

    await asArgo.fleet.release.mutate({ shipId });
    const { prompt } = await asArgo.fleet.getStartingPrompt.mutate({ shipId });
    const { crewToken } = await client().ship.register.mutate({
      shipId,
      secret: secretIn(prompt),
      location: { kind: 'DEVICE' }, harness: 'claude-code',
    });

    await expect(client({ authorization: `Bearer ${crewToken}` }).ship.receive.mutate({})).resolves.toMatchObject({
      deliveries: [{ deliveryId, attempts: 2 }],
    });
  });

  it('deregister needs no scope: only the crew token', async () => {
    const crewToken = await crewedShip([]);

    await expect(client({ authorization: `Bearer ${crewToken}` }).ship.deregister.mutate()).resolves.toEqual({});
  });

  it('refuse release and deregister without a caller', async () => {
    await expect(codeOf(client().fleet.release.mutate({ shipId: newId('ship') }))).resolves.toBe('UNAUTHORIZED');
    await expect(codeOf(client().ship.deregister.mutate())).resolves.toBe('UNAUTHORIZED');
  });

  it('refuse deregister with the console session: it takes a crew token', async () => {
    await expect(refusalOf((await signedInArgo()).ship.deregister.mutate())).resolves.toEqual({
      code: 'UNAUTHORIZED',
      message: 'Call with the crew token register gave you',
    });
  });

  it('refuse release to an agent ship, which lacks fleet:manage, and the ship stays crewed', async () => {
    const { shipId, asShip } = await crewed('coracle');

    await expect(codeOf(asShip.fleet.release.mutate({ shipId }))).resolves.toBe('FORBIDDEN');
    await expect(asShip.ship.whoami.query()).resolves.toMatchObject({ shipId });
  });

  it('refuse to release argo, a ship awaiting crew, and a ship that does not exist', async () => {
    const asArgo = await signedInArgo();
    const { shipId: awaiting } = await asArgo.fleet.commission.mutate({ idempotencyKey: newKey(), name: 'punt', type: 'rower' });
    const unknown = newId('ship');

    await expect(refusalOf(asArgo.fleet.release.mutate({ shipId: argoId }))).resolves.toEqual({
      code: 'FORBIDDEN',
      message: 'argo is the operator ship and can never be released',
    });
    await expect(refusalOf(asArgo.fleet.release.mutate({ shipId: awaiting }))).resolves.toEqual({
      code: 'CONFLICT',
      message: 'punt is awaiting crew: only a crewed ship is released. A new starting prompt replaces an unclaimed one',
    });
    await expect(refusalOf(asArgo.fleet.release.mutate({ shipId: unknown }))).resolves.toEqual({
      code: 'NOT_FOUND',
      message: `Ship ${unknown} does not exist`,
    });
  });
});

describe('text input holding U+0000 at the API', () => {
  it('refuses a note holding U+0000 with BAD_REQUEST, and commissions nothing', async () => {
    const asArgo = await signedInArgo();

    await expect(
      refusalOf(asArgo.fleet.commission.mutate({ idempotencyKey: newKey(), name: 'nul-note', type: 'reviewer', note: 'reviews\u0000' })),
    ).resolves.toEqual({ code: 'BAD_REQUEST', message: 'The input field note cannot hold the character U+0000 (NUL)' });
    await expect(database.ship.count({ where: { name: 'nul-note' } })).resolves.toBe(0);
  });

  it('refuses a location description holding U+0000 with BAD_REQUEST, and opens no lease', async () => {
    const { shipId, prompt } = await (await signedInArgo()).fleet.commission.mutate({ idempotencyKey: newKey(), name: 'nul-lookout', type: 'reviewer' });

    await expect(
      refusalOf(
        client().ship.register.mutate({
          shipId,
          secret: secretIn(prompt),
          location: { kind: 'OTHER', description: 'ci\u0000runner' }, harness: 'claude-code',
        }),
      ),
    ).resolves.toEqual({
      code: 'BAD_REQUEST',
      message: 'The input field location.description cannot hold the character U+0000 (NUL)',
    });
    await expect(database.lease.count({ where: { shipId } })).resolves.toBe(0);
  });
});

describe('state-changing console calls from a foreign origin', () => {
  const FOREIGN = 'https://sibling.fleet.example.com';

  it('refuse a commission with the session cookie from a foreign origin, and commission nothing', async () => {
    clock.advance(SIGN_IN_RATE_LIMIT.windowMs);
    const cookie = sessionCookieOf(await signIn());

    await expect(
      refusalOf(client({ cookie, origin: FOREIGN }).fleet.commission.mutate({ idempotencyKey: newKey(), name: 'forged', type: 'reviewer' })),
    ).resolves.toEqual({ code: 'FORBIDDEN', message: "A console call that changes state must come from the console's origin" });
    await expect(database.ship.count({ where: { name: 'forged' } })).resolves.toBe(0);
  });

  it('refuse a commission with the session cookie and no Origin', async () => {
    clock.advance(SIGN_IN_RATE_LIMIT.windowMs);
    const cookie = sessionCookieOf(await signIn());

    await expect(codeOf(client({ cookie }).fleet.commission.mutate({ idempotencyKey: newKey(), name: 'forged', type: 'reviewer' }))).resolves.toBe(
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

describe('the ship page reads at the API', () => {
  it('serve a ship, its timeline and messages, and one message with its delivery history, to argo', async () => {
    const asArgo = await signedInArgo();
    const { shipId, prompt } = await asArgo.fleet.commission.mutate({ idempotencyKey: newKey(), name: `pager-${newId('ship').slice(-6)}`, type: 'reviewer' });
    const { crewToken } = await client().ship.register.mutate({ shipId, secret: secretIn(prompt), location: { kind: 'DEVICE' }, harness: 'claude-code' });
    const { messageId } = await client({ authorization: `Bearer ${crewToken}` }).ship.send.mutate({
      selector: { kind: 'ship', name: 'argo' },
      payload: 'Done with PR 48',
      model: 'claude-opus-5-5',
      idempotencyKey: `done-${newId('message')}`,
    });

    const ship = await asArgo.fleet.ship.query({ shipId });
    const timeline = await asArgo.fleet.shipTimeline.query({ shipId });
    const messages = await asArgo.fleet.shipMessages.query({ shipId });
    const message = await asArgo.fleet.message.query({ messageId });

    expect(ship).toMatchObject({ id: shipId, status: 'crewed', crewedSince: clock.now().toISOString(), retiredAt: null });
    expect(timeline[0]).toMatchObject({ type: 'MessageAccepted', actor: { id: shipId }, message: { id: messageId } });
    expect(messages).toMatchObject([{ id: messageId, preview: 'Done with PR 48', delivery: { state: 'pending' } }]);
    expect(message).toMatchObject({
      id: messageId,
      payload: 'Done with PR 48',
      recipient: { kind: 'ship', ship: { id: argoId, name: 'argo' } },
      delivery: { state: 'pending', history: [{ type: 'MessageAccepted' }] },
    });
  });

  it('refuse them to a ship without fleet:read', async () => {
    const reader = client({ authorization: `Bearer ${await crewedShip()}` });

    await expect(codeOf(reader.fleet.ship.query({ shipId: argoId }))).resolves.toBe('FORBIDDEN');
    await expect(codeOf(reader.fleet.shipTimeline.query({ shipId: argoId }))).resolves.toBe('FORBIDDEN');
    await expect(codeOf(reader.fleet.shipMessages.query({ shipId: argoId }))).resolves.toBe('FORBIDDEN');
    await expect(codeOf(reader.fleet.message.query({ messageId: newId('message') }))).resolves.toBe('FORBIDDEN');
  });

  it('answer NOT_FOUND for a ship or message the fleet does not have', async () => {
    const asArgo = await signedInArgo();

    await expect(codeOf(asArgo.fleet.ship.query({ shipId: newId('ship') }))).resolves.toBe('NOT_FOUND');
    await expect(codeOf(asArgo.fleet.shipTimeline.query({ shipId: newId('ship') }))).resolves.toBe('NOT_FOUND');
    await expect(codeOf(asArgo.fleet.shipMessages.query({ shipId: newId('ship') }))).resolves.toBe('NOT_FOUND');
    await expect(codeOf(asArgo.fleet.message.query({ messageId: newId('message') }))).resolves.toBe('NOT_FOUND');
  });
});

describe('retire and re-crew at the API', () => {
  it('retire a ship for fleet:manage, answering how many deliveries it abandoned; the ship reads retired', async () => {
    const asArgo = await signedInArgo();
    const { shipId } = await asArgo.fleet.commission.mutate({ idempotencyKey: newKey(), name: `retiree-${newId('ship').slice(-6)}`, type: 'reviewer' });

    await expect(asArgo.fleet.retire.mutate({ shipId })).resolves.toEqual({ abandonedDeliveries: 0 });
    await expect(asArgo.fleet.ship.query({ shipId })).resolves.toMatchObject({ status: 'retired', openDeliveries: 0 });
    await expect(codeOf(asArgo.fleet.retire.mutate({ shipId }))).resolves.toBe('CONFLICT');
    await expect(codeOf(asArgo.fleet.retire.mutate({ shipId: argoId }))).resolves.toBe('FORBIDDEN');
  });

  it('re-crew a crewed ship for fleet:manage, answering a new starting prompt and crew line', async () => {
    const asArgo = await signedInArgo();
    const { shipId, prompt } = await asArgo.fleet.commission.mutate({ idempotencyKey: newKey(), name: `recrew-${newId('ship').slice(-6)}`, type: 'reviewer' });
    const { crewToken } = await client().ship.register.mutate({ shipId, secret: secretIn(prompt), location: { kind: 'DEVICE' }, harness: 'claude-code' });

    const issued = await asArgo.fleet.recrew.mutate({ shipId });

    expect(issued.crewLines).toEqual([
      { harness: 'claude-code', line: `/aeolus:crew ${FLEET_URL} ${shipId} ${issued.secret}` },
      { harness: 'codex', line: `$aeolus-crew ${FLEET_URL} ${shipId} ${issued.secret}` },
    ]);
    expect(secretIn(issued.prompt)).toBe(issued.secret);
    await expect(codeOf(client({ authorization: `Bearer ${crewToken}` }).ship.whoami.query())).resolves.toBe('UNAUTHORIZED');
    await expect(codeOf(asArgo.fleet.recrew.mutate({ shipId }))).resolves.toBe('CONFLICT');
  });

  it('refuse retire and re-crew to a ship without fleet:manage', async () => {
    const reader = client({ authorization: `Bearer ${await crewedShip(['fleet:read'])}` });

    await expect(codeOf(reader.fleet.retire.mutate({ shipId: argoId }))).resolves.toBe('FORBIDDEN');
    await expect(codeOf(reader.fleet.recrew.mutate({ shipId: argoId }))).resolves.toBe('FORBIDDEN');
  });
});

describe('Needs attention at the API', () => {
  /** A message from argo that a crewed ship received five times without acknowledging it: undeliverable. */
  async function undeliverableFromArgo(asArgo: TRPCClient<AppRouter>): Promise<{ deliveryId: string; messageId: string }> {
    const crew = client({ authorization: `Bearer ${await crewedShip()}` });
    const { shipId } = await crew.ship.whoami.query();
    const { messageId } = await asArgo.ship.send.mutate({
      selector: { kind: 'ship', shipId },
      payload: 'Pause all reviews until 15:00.',
      idempotencyKey: `pause-${newId('message')}`,
    });
    let deliveryId = '';
    for (let claim = 1; claim < 5; claim += 1) {
      const { deliveries } = await crew.ship.receive.mutate({});
      deliveryId = deliveries[0]?.deliveryId ?? '';
    }
    await crew.ship.receive.mutate({});
    return { deliveryId, messageId };
  }

  it('list the undeliverable deliveries for fleet:read, each with its message', async () => {
    const asArgo = await signedInArgo();
    const { deliveryId, messageId } = await undeliverableFromArgo(asArgo);

    const listed = (await asArgo.fleet.needsAttention.query()).find((entry) => entry.deliveryId === deliveryId);

    expect(listed).toMatchObject({
      attempts: 5,
      message: { id: messageId, sender: { id: argoId, name: 'argo' }, payload: 'Pause all reviews until 15:00.' },
    });
  });

  it('dismiss one for fleet:manage; it leaves the list, and a second dismiss is OK', async () => {
    const asArgo = await signedInArgo();
    const { deliveryId } = await undeliverableFromArgo(asArgo);

    await expect(asArgo.fleet.dismiss.mutate({ deliveryId })).resolves.toEqual({});
    await expect(asArgo.fleet.dismiss.mutate({ deliveryId })).resolves.toEqual({});
    expect((await asArgo.fleet.needsAttention.query()).map((entry) => entry.deliveryId)).not.toContain(deliveryId);
    await expect(codeOf(asArgo.fleet.resend.mutate({ deliveryId }))).resolves.toBe('CONFLICT');
  });

  it('resend one for fleet:manage, answering the new message, which names the original', async () => {
    const asArgo = await signedInArgo();
    const { deliveryId, messageId } = await undeliverableFromArgo(asArgo);

    const resent = await asArgo.fleet.resend.mutate({ deliveryId });

    expect(resent.messageId).not.toBe(messageId);
    await expect(database.message.findUniqueOrThrow({ where: { id: resent.messageId } })).resolves.toMatchObject({
      senderShipId: argoId,
      resendOfMessageId: messageId,
    });
    expect((await asArgo.fleet.needsAttention.query()).map((entry) => entry.deliveryId)).not.toContain(deliveryId);
  });

  it('answer NOT_FOUND for a delivery the fleet does not have', async () => {
    const asArgo = await signedInArgo();

    await expect(codeOf(asArgo.fleet.dismiss.mutate({ deliveryId: newId('delivery') }))).resolves.toBe('NOT_FOUND');
    await expect(codeOf(asArgo.fleet.resend.mutate({ deliveryId: newId('delivery') }))).resolves.toBe('NOT_FOUND');
  });

  it('refuse dismiss and resend without fleet:manage, and the list without fleet:read', async () => {
    const reader = client({ authorization: `Bearer ${await crewedShip(['fleet:read'])}` });
    const agent = client({ authorization: `Bearer ${await crewedShip()}` });

    await expect(codeOf(reader.fleet.dismiss.mutate({ deliveryId: newId('delivery') }))).resolves.toBe('FORBIDDEN');
    await expect(codeOf(reader.fleet.resend.mutate({ deliveryId: newId('delivery') }))).resolves.toBe('FORBIDDEN');
    await expect(codeOf(agent.fleet.needsAttention.query())).resolves.toBe('FORBIDDEN');
  });
});

describe("argo's inbox at the API", () => {
  /** A message to argo from a crewed agent ship; answers its delivery and its sender's crew token. */
  async function toArgo(payload: string): Promise<{ deliveryId: string; messageId: string; crewToken: string }> {
    const crewToken = await crewedShip();
    const { messageId } = await client({ authorization: `Bearer ${crewToken}` }).ship.send.mutate({
      selector: { kind: 'ship', shipId: argoId },
      payload,
      model: 'claude-opus-5-5',
      idempotencyKey: `ask-${newId('message')}`,
    });
    const { id } = await database.delivery.findFirstOrThrow({ where: { messageId } });
    return { deliveryId: id, messageId, crewToken };
  }

  it('list the messages to argo by filter for its console session', async () => {
    const asArgo = await signedInArgo();
    const { deliveryId, messageId } = await toArgo('Promote 2.14?');

    const open = await asArgo.fleet.inbox.query({ filter: 'open' });

    expect(open.find((entry) => entry.deliveryId === deliveryId)).toMatchObject({
      state: 'pending',
      readAt: null,
      message: { id: messageId, payload: 'Promote 2.14?' },
    });
  });

  it('mark a message read and done, answering {}; it moves from open to done', async () => {
    const asArgo = await signedInArgo();
    const { deliveryId } = await toArgo('checkout-e2e failed.');

    await expect(asArgo.fleet.markRead.mutate({ deliveryId, isRead: true })).resolves.toEqual({});
    await expect(asArgo.fleet.markDone.mutate({ deliveryId })).resolves.toEqual({});

    expect((await asArgo.fleet.inbox.query({ filter: 'open' })).map((entry) => entry.deliveryId)).not.toContain(deliveryId);
    expect((await asArgo.fleet.inbox.query({ filter: 'done' })).find((entry) => entry.deliveryId === deliveryId)).toMatchObject({
      readAt: clock.now().toISOString(),
      doneAt: clock.now().toISOString(),
    });
  });

  it('reply to a message: the sender receives the reply, and the message is done', async () => {
    const asArgo = await signedInArgo();
    const { deliveryId, messageId, crewToken } = await toArgo('Promote 2.14?');

    const reply = await asArgo.fleet.reply.mutate({ deliveryId, payload: 'go', idempotencyKey: `go-${deliveryId}` });

    const { deliveries } = await client({ authorization: `Bearer ${crewToken}` }).ship.receive.mutate({});
    expect(deliveries).toEqual([
      expect.objectContaining({ messageId: reply.messageId, payload: 'go', inReplyTo: messageId }),
    ]);
    expect((await asArgo.fleet.inbox.query({ filter: 'done' })).find((entry) => entry.deliveryId === deliveryId)).toMatchObject({
      repliedWith: reply.messageId,
    });
  });

  it("answer NOT_FOUND for a delivery not in argo's inbox", async () => {
    const asArgo = await signedInArgo();

    await expect(codeOf(asArgo.fleet.markDone.mutate({ deliveryId: newId('delivery') }))).resolves.toBe('NOT_FOUND');
    await expect(codeOf(asArgo.fleet.markRead.mutate({ deliveryId: newId('delivery'), isRead: true }))).resolves.toBe('NOT_FOUND');
    await expect(
      codeOf(asArgo.fleet.reply.mutate({ deliveryId: newId('delivery'), payload: 'go', idempotencyKey: 'go' })),
    ).resolves.toBe('NOT_FOUND');
  });

  it('refuse any ship but argo, even with every scope', async () => {
    const agent = client({ authorization: `Bearer ${await crewedShip([...SCOPES])}` });
    const { deliveryId } = await toArgo('Promote 2.14?');

    await expect(codeOf(agent.fleet.markDone.mutate({ deliveryId }))).resolves.toBe('FORBIDDEN');
    await expect(codeOf(agent.fleet.markRead.mutate({ deliveryId, isRead: true }))).resolves.toBe('FORBIDDEN');
    await expect(codeOf(agent.fleet.reply.mutate({ deliveryId, payload: 'go', idempotencyKey: 'go' }))).resolves.toBe('FORBIDDEN');
  });

  it('refuse the inbox without fleet:read', async () => {
    const agent = client({ authorization: `Bearer ${await crewedShip()}` });

    await expect(codeOf(agent.fleet.inbox.query({ filter: 'all' }))).resolves.toBe('FORBIDDEN');
  });
});

describe('rename at the API', () => {
  it('rename a ship for fleet:manage; the ship reads its new name', async () => {
    const asArgo = await signedInArgo();
    const { shipId } = await asArgo.fleet.commission.mutate({ idempotencyKey: newKey(), name: `old-${newId('ship').slice(-6)}`, type: 'reviewer' });
    const name = `new-${newId('ship').slice(-6)}`;

    await expect(asArgo.fleet.rename.mutate({ shipId, name })).resolves.toEqual({});
    await expect(asArgo.fleet.ship.query({ shipId })).resolves.toMatchObject({ name });
  });

  it('refuse argo, a taken name, and a ship without fleet:manage', async () => {
    const asArgo = await signedInArgo();
    const { shipId } = await asArgo.fleet.commission.mutate({ idempotencyKey: newKey(), name: `one-${newId('ship').slice(-6)}`, type: 'reviewer' });
    const taken = `two-${newId('ship').slice(-6)}`;
    await asArgo.fleet.commission.mutate({ idempotencyKey: newKey(), name: taken, type: 'reviewer' });
    const reader = client({ authorization: `Bearer ${await crewedShip(['fleet:read'])}` });

    await expect(codeOf(asArgo.fleet.rename.mutate({ shipId: argoId, name: 'helm' }))).resolves.toBe('FORBIDDEN');
    await expect(codeOf(asArgo.fleet.rename.mutate({ shipId, name: taken }))).resolves.toBe('CONFLICT');
    await expect(codeOf(reader.fleet.rename.mutate({ shipId, name: 'any' }))).resolves.toBe('FORBIDDEN');
  });
});

describe("the operator's account at the API", () => {
  const MAC_CHROME =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

  it("names this session by the sign-in's User-Agent, as argo's location too", async () => {
    clock.advance(SIGN_IN_RATE_LIMIT.windowMs);
    const response = await fetch(`${address}/trpc/console.signIn`, {
      method: 'POST',
      headers: { origin: CONSOLE, 'content-type': 'application/json', 'user-agent': MAC_CHROME },
      body: JSON.stringify(OPERATOR),
    });
    const asArgo = client({ cookie: sessionCookieOf(response), origin: CONSOLE });

    await expect(asArgo.console.account.query()).resolves.toMatchObject({
      email: OPERATOR.email,
      session: { device: 'Mac · Chrome', since: clock.now().toISOString() },
    });
    const argo = (await asArgo.fleet.list.query()).find((ship) => ship.kind === 'operator');
    expect(argo?.location).toEqual({ kind: 'OTHER', description: 'Mac · Chrome' });
  });

  it('keeps the chosen theme on the account, across sign-ins', async () => {
    const asArgo = await signedInArgo();

    await expect(asArgo.console.setTheme.mutate({ theme: 'dark' })).resolves.toEqual({});
    const next = await signedInArgo();
    await expect(next.console.account.query()).resolves.toMatchObject({ theme: 'dark' });
    await next.console.setTheme.mutate({ theme: 'system' });
  });

  it('refuses the account to a ship that is no console session', async () => {
    const agent = client({ authorization: `Bearer ${await crewedShip([...SCOPES])}` });

    await expect(codeOf(agent.console.account.query())).resolves.toBe('FORBIDDEN');
    await expect(codeOf(agent.console.setTheme.mutate({ theme: 'dark' }))).resolves.toBe('FORBIDDEN');
  });
});

describe('last seen at the API', () => {
  it("shows a crewed ship's last call in the fleet list, and argo's from its console session", async () => {
    const crewToken = await crewedShip();
    const asShip = client({ authorization: `Bearer ${crewToken}` });
    const { shipId } = await asShip.ship.whoami.query();
    clock.advance(30_000);
    await asShip.ship.whoami.query();
    const seenAt = clock.now().toISOString();
    const asArgo = await signedInArgo();
    clock.advance(5_000);

    const ships = await asArgo.fleet.list.query();

    expect(ships.find((ship) => ship.id === shipId)?.lastSeenAt).toBe(seenAt);
    expect(ships.find((ship) => ship.kind === 'operator')?.lastSeenAt).toBe(clock.now().toISOString());
  });
});

describe('/api/version', () => {
  it('names the latest migration applied to the database', async () => {
    const response = await fetch(`${address}/api/version`);

    expect(response.status).toBe(200);
    const { server: serverVersion, migration } = z
      .object({ server: z.string(), migration: z.string() })
      .parse(await response.json());
    expect(serverVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(migration).toMatch(/^\d{14}_crew_scopes$/);
  });
});

describe('fleet.ping and ship.pong at the API', () => {
  /** A ship commissioned by argo and claimed through register: its id and a client calling with its crew token. */
  async function crewed(name: string): Promise<{ shipId: ShipId; asShip: TRPCClient<AppRouter> }> {
    const { shipId, prompt } = await (await signedInArgo()).fleet.commission.mutate({ idempotencyKey: newKey(), name, type: 'rower' });
    const { crewToken } = await client().ship.register.mutate({
      shipId,
      secret: secretIn(prompt),
      location: { kind: 'CLOUD' }, harness: 'claude-code',
    });
    return { shipId, asShip: client({ authorization: `Bearer ${crewToken}` }) };
  }

  it('ping a crewed ship as argo, and answer with the open ping while it waits', async () => {
    const { shipId } = await crewed('ping-skiff');
    const asArgo = await signedInArgo();

    const first = await asArgo.fleet.ping.mutate({ shipId });
    const again = await asArgo.fleet.ping.mutate({ shipId });

    expect(first).toMatchObject({ sentAt: clock.now().toISOString(), isNew: true });
    expect(first.messageId).toMatch(/^msg_/);
    expect(again).toEqual({ ...first, isNew: false });
  });

  it('let the ship answer its ping with pong: the delivery is acknowledged', async () => {
    const { shipId, asShip } = await crewed('ping-dory');
    const { messageId } = await (await signedInArgo()).fleet.ping.mutate({ shipId });
    const { deliveries } = await asShip.ship.receive.mutate({});
    const deliveryId = idSchema('delivery').parse(deliveries[0]?.deliveryId);

    await expect(asShip.ship.pong.mutate({ deliveryId })).resolves.toEqual({});

    expect(deliveries[0]).toMatchObject({ messageId, contentType: 'application/vnd.aeolus.ping' });
    await expect(database.delivery.findUniqueOrThrow({ where: { id: deliveryId } })).resolves.toMatchObject({
      state: 'acknowledged',
    });
  });

  it('refuse pong for a delivery that is not a ping with CONFLICT', async () => {
    const { shipId, asShip } = await crewed('ping-punt');
    await (await signedInArgo()).ship.send.mutate({
      selector: { kind: 'ship', shipId },
      payload: 'Row to the jetty',
      contentType: 'text/plain',
      idempotencyKey: `key-${newId('message')}`,
    });
    const { deliveries } = await asShip.ship.receive.mutate({});

    const refusal = await refusalOf(
      asShip.ship.pong.mutate({ deliveryId: idSchema('delivery').parse(deliveries[0]?.deliveryId) }),
    );

    expect(refusal?.code).toBe('CONFLICT');
    expect(refusal?.message).toMatch(/is not a ping: pong answers only a ping/);
  });

  it('refuse fleet.ping to a ship without fleet:manage', async () => {
    const { shipId } = await crewed('ping-coracle');
    const crewToken = await crewedShip();

    await expect(refusalOf(client({ authorization: `Bearer ${crewToken}` }).fleet.ping.mutate({ shipId }))).resolves.toEqual({
      code: 'FORBIDDEN',
      message: 'This call needs the fleet:manage scope',
    });
  });

  it('refuse a send with the reserved ping content type, even from argo', async () => {
    const { shipId } = await crewed('ping-kayak');

    await expect(
      refusalOf(
        (await signedInArgo()).ship.send.mutate({
          selector: { kind: 'ship', shipId },
          payload: 'ping',
          contentType: 'application/vnd.aeolus.ping',
          idempotencyKey: `key-${newId('message')}`,
        }),
      ),
    ).resolves.toEqual({
      code: 'FORBIDDEN',
      message: 'application/vnd.aeolus.ping is reserved for pings: ping a ship from the console',
    });
  });
});

describe('ship names and types with a colon at the API', () => {
  it('commission, send by name and by type over REST, and rename a ship whose name and type hold a colon', async () => {
    const asArgo = await signedInArgo();
    const { shipId, prompt } = await asArgo.fleet.commission.mutate({ idempotencyKey: newKey(), name: 'hemma-a1b2:planner', type: 'hemma:planner' });
    const { crewToken } = await client().ship.register.mutate({ shipId, secret: secretIn(prompt), location: { kind: 'CLOUD' }, harness: 'claude-code' });
    await asArgo.ship.send.mutate({
      selector: { kind: 'ship', name: 'hemma-a1b2:planner' },
      payload: 'By name',
      contentType: 'text/plain',
      idempotencyKey: `key-${newId('message')}`,
    });
    await asArgo.ship.send.mutate({
      selector: { kind: 'type', type: 'hemma:planner' },
      payload: 'By type',
      contentType: 'text/plain',
      idempotencyKey: `key-${newId('message')}`,
    });

    const received = await fetch(`${address}/api/v1/ship/receive`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${crewToken}` },
      body: JSON.stringify({ max: 10 }),
    });
    await asArgo.fleet.rename.mutate({ shipId, name: 'hemma-a1b2:lookout' });

    const { deliveries } = z
      .object({ deliveries: z.array(z.object({ payload: z.string() })) })
      .parse(await received.json());
    expect(deliveries.map((delivery) => delivery.payload).sort()).toEqual(['By name', 'By type']);
    const listed = await asArgo.fleet.list.query();
    expect(listed.find((ship) => ship.id === shipId)).toMatchObject({ name: 'hemma-a1b2:lookout', type: 'hemma:planner' });
  });
});

describe('ships with fleet scopes at the API', () => {
  async function commissionedAndCrewed(
    name: string,
    fleetScopes: ('fleet:read' | 'fleet:manage')[],
  ): Promise<{ shipId: ShipId; asShip: TRPCClient<AppRouter> }> {
    const { shipId, prompt } = await (await signedInArgo()).fleet.commission.mutate({ idempotencyKey: newKey(), name, type: 'squadron', fleetScopes });
    const { crewToken } = await client().ship.register.mutate({ shipId, secret: secretIn(prompt), location: { kind: 'SERVER' }, harness: 'claude-code' });
    return { shipId, asShip: client({ authorization: `Bearer ${crewToken}` }) };
  }

  it('list the ship with the scopes it was commissioned with', async () => {
    const { shipId } = await commissionedAndCrewed('scoped-watcher', ['fleet:read']);

    const listed = await (await signedInArgo()).fleet.list.query();

    expect(listed.find((ship) => ship.id === shipId)?.scopes).toEqual(['messages:send', 'messages:receive', 'fleet:read']);
  });

  it('let a ship with fleet:read read the fleet with its crew token', async () => {
    const { asShip } = await commissionedAndCrewed('scoped-reader', ['fleet:read']);

    const listed = await asShip.fleet.list.query();

    expect(listed.map((ship) => ship.name)).toContain('scoped-reader');
  });

  it('let a ship with fleet:manage commission a ship, and refuse it to a ship with only fleet:read', async () => {
    const { asShip: manager } = await commissionedAndCrewed('scoped-manager', ['fleet:read', 'fleet:manage']);
    const { asShip: reader } = await commissionedAndCrewed('scoped-onlooker', ['fleet:read']);

    const { shipId } = await manager.fleet.commission.mutate({ idempotencyKey: newKey(), name: 'scoped-member', type: 'squadron' });

    expect(shipId).toMatch(/^shp_/);
    await expect(refusalOf(reader.fleet.commission.mutate({ idempotencyKey: newKey(), name: 'scoped-other', type: 'squadron' }))).resolves.toEqual({
      code: 'FORBIDDEN',
      message: 'This call needs the fleet:manage scope',
    });
  });
});

describe('fleet.follow at the API', () => {
  async function crewedReader(name: string): Promise<TRPCClient<AppRouter>> {
    const { shipId, prompt } = await (await signedInArgo()).fleet.commission.mutate({ idempotencyKey: newKey(), name, type: 'squadron', fleetScopes: ['fleet:read'] });
    const { crewToken } = await client().ship.register.mutate({ shipId, secret: secretIn(prompt), location: { kind: 'SERVER' }, harness: 'claude-code' });
    return client({ authorization: `Bearer ${crewToken}` });
  }

  it('answers a ship with fleet:read the events after its position, as soon as one commits while it waits', async () => {
    const reader = await crewedReader('follow-reader');
    // Signing in writes events of its own: before the position is read.
    const asArgo = await signedInArgo();
    const { lastSeq } = await reader.fleet.follow.query({});

    const following = reader.fleet.follow.query({ afterSeq: lastSeq, waitSeconds: 20 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const { shipId } = await asArgo.fleet.commission.mutate({ idempotencyKey: newKey(), name: 'follow-new', type: 'squadron' });

    const { events } = await following;
    expect(events[0]).toMatchObject({ type: 'ShipCommissioned', shipId });
    expect(events[0]?.seq).toBe(lastSeq + 1);
  });

  it('refuse follow to a ship without fleet:read', async () => {
    const crewToken = await crewedShip();

    await expect(refusalOf(client({ authorization: `Bearer ${crewToken}` }).fleet.follow.query({}))).resolves.toEqual({
      code: 'FORBIDDEN',
      message: 'This call needs the fleet:read scope',
    });
  });
});

describe('console.session for another service', () => {
  /** A call as a server makes it: the browser's cookie forwarded, no origin. */
  function fromAnotherService(headers: Record<string, string>) {
    return fetch(`${address}/trpc/console.session`, { headers });
  }

  it('answers the fleet and the expiry of a signed-in console session, from its forwarded cookie', async () => {
    const cookie = sessionCookieOf(await signIn());

    const response = await fromAnotherService({ cookie });

    expect(response.status).toBe(200);
    const { result } = z.object({ result: z.object({ data: z.object({ fleetId: z.string(), expiresAt: z.string() }) }) }).parse(await response.json());
    expect(result.data.fleetId).toBe(fleetId);
    expect(new Date(result.data.expiresAt).getTime()).toBeGreaterThan(clock.now().getTime());
  });

  it('refuses without a cookie, with a crew token alone, and once the operator signed out', async () => {
    clock.advance(SIGN_IN_RATE_LIMIT.windowMs);
    const cookie = sessionCookieOf(await signIn());
    await client({ cookie, origin: CONSOLE }).console.signOut.mutate();

    const statuses = await Promise.all([
      fromAnotherService({}).then((response) => response.status),
      fromAnotherService({ authorization: `Bearer ${await crewedShip()}` }).then((response) => response.status),
      fromAnotherService({ cookie }).then((response) => response.status),
    ]);

    expect(statuses).toEqual([401, 401, 401]);
  });
});
