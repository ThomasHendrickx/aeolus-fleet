import { createServer, type Server } from 'node:http';

import { SCOPES, type FleetId, type MessageId, type ShipId } from '@aeolus-fleet/common';
import { createTRPCClient, httpLink, TRPCClientError, type TRPCClient } from '@trpc/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { z } from 'zod';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createApp } from '../src/app.js';
import type { ShipCaller } from '../src/domain/shared/caller.js';
import type { AppRouter } from '../src/index.js';
import { createTestIssuer, type TestIssuer } from '../src/testing/account-token-issuer.js';
import { createMigratedDatabase } from '../src/testing/database.js';
import { secretOf } from '../src/testing/fleet.js';
import { newKey } from '../src/testing/keys.js';
import { unwrap } from '../src/testing/result.js';
import { createUseCases, type UseCases } from '../src/wiring.js';
import { FLEET_URL } from './support/core-fixtures.js';
import { createTestClock } from './support/postgres-core.js';

// An account signed in to the console (accounts design, F1, A3; decision
// 0058): the console's server presents the account token pagasae gave it,
// core keeps it in an httpOnly cookie of its own, and the browser's calls and
// live updates then act as that account, with no lease. A change by the
// cookie comes only from the console's origin, as for argo's cookie.

const INSTALLATION_TOKEN = 'aeolus_installation_test_0123456789abcdef';
const CONSOLE = new URL(FLEET_URL).origin;
const clock = createTestClock('2026-10-21T10:00:00.000Z');

let keys: Server;
let issuer: TestIssuer;
let database: PrismaClient;
let useCases: UseCases;
let fleetServer: FastifyInstance;
let address: string;
let fleetId: FleetId;
let argo: ShipCaller;
let scout: ShipId;
let toArgo: MessageId;

function seconds(at: Date): number {
  return Math.floor(at.getTime() / 1000);
}

/** A token pagasae signs for Mathilde in the fleet now, for 10 minutes. */
function mathildeToken(overrides: Record<string, unknown> = {}): string {
  const now = seconds(clock.now());
  return issuer.sign({ iss: issuer.issuer, aud: fleetId, sub: 'acc-mathilde', org: 'org-acme', scope: 'fleet:read fleet:commission', group: [], iat: now, exp: now + 600, ...overrides });
}

/** The console's server presenting a token: core's answer, with the cookie it sets. */
function present(token: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${address}/trpc/console.presentAccountToken`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ token }),
  });
}

/** The cookie a presented token gave, as the browser then sends it. */
async function signedInCookie(): Promise<string> {
  const answer = await present(mathildeToken());
  const cookie = answer.headers.get('set-cookie');
  if (!answer.ok || cookie === null) {
    throw new Error(`presenting the token set no cookie: ${String(answer.status)}`);
  }
  return cookie.split(';')[0] ?? '';
}

function asBrowser(cookie: string, origin = CONSOLE): TRPCClient<AppRouter> {
  return createTRPCClient<AppRouter>({ links: [httpLink({ url: `${address}/trpc`, headers: { cookie, origin } })] });
}

async function codeOf(call: Promise<unknown>): Promise<string | undefined> {
  try {
    await call;
  } catch (error) {
    if (error instanceof TRPCClientError) {
      const data: unknown = error.data;
      return typeof data === 'object' && data !== null && 'code' in data && typeof data.code === 'string' ? data.code : undefined;
    }
    throw error;
  }
  return undefined;
}

beforeAll(async () => {
  keys = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(issuer.keySet()));
  });
  await new Promise<void>((listening) => keys.listen(0, '127.0.0.1', listening));
  const bound = keys.address();
  if (bound === null || typeof bound === 'string') {
    throw new Error('the key set server listens on no port');
  }
  issuer = createTestIssuer(`http://127.0.0.1:${String(bound.port)}`);

  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  useCases = createUseCases({ prisma: database, clock });
  fleetServer = createApp({ databaseUrl, publicUrl: FLEET_URL, logger: false, clock, installationToken: INSTALLATION_TOKEN, accountTokenIssuer: issuer.issuer });
  address = await fleetServer.listen({ host: '127.0.0.1', port: 0 });

  const installation = createTRPCClient<AppRouter>({ links: [httpLink({ url: `${address}/trpc`, headers: { 'x-aeolus-installation-token': INSTALLATION_TOKEN } })] }).installation;
  const created = await installation.fleets.create.mutate({ requestId: newKey(), name: 'acme', operatorEmail: 'acme@example.com' });
  ({ fleetId } = created);
  argo = { shipId: created.operatorShipId, fleetId, kind: 'operator', scopes: [...SCOPES] };

  const commissioned = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
  scout = commissioned.shipId;
  const { crewToken } = unwrap(await useCases.claimShip({ shipId: scout, secret: secretOf(commissioned.secret), location: { kind: 'CLOUD' }, harness: 'claude-code' }));
  const crew = unwrap(await useCases.authenticate.byCrewToken(crewToken));
  ({ messageId: toArgo } = unwrap(
    await useCases.sendMessage(crew, { selector: { kind: 'ship', name: 'argo' }, payload: 'Review is done', contentType: 'text/plain', idempotencyKey: newKey(), model: 'claude-opus-5-5' }),
  ));
});

afterAll(async () => {
  await fleetServer.close();
  await database.$disconnect();
  keys.close();
});

describe("presenting an account token for the console's sign-in", () => {
  it('keeps it in an httpOnly, Secure, SameSite=Strict cookie for as long as the token lasts', async () => {
    const answer = await present(mathildeToken());

    expect(answer.status).toBe(200);
    expect(answer.headers.get('set-cookie')).toMatch(/^aeolus_account_token=[^;]+; Max-Age=600; Path=\/; HttpOnly; Secure; SameSite=Strict$/);
  });

  it('refuses a token core does not trust, and sets no cookie', async () => {
    const answer = await present(mathildeToken({ aud: 'flt_01m5fghxxxxxxxxxxxxxxxxxxx' }));

    expect(answer.status).toBe(401);
    expect(answer.headers.get('set-cookie')).toBeNull();
  });

  it("refuses a browser on another site posting a token, so no page signs a visitor in as someone else's account", async () => {
    const answer = await present(mathildeToken(), { origin: 'https://evil.example' });

    expect(answer.status).toBe(403);
    expect(answer.headers.get('set-cookie')).toBeNull();
  });

  it("takes a token from the console's origin too", async () => {
    await expect(present(mathildeToken(), { origin: CONSOLE })).resolves.toMatchObject({ status: 200 });
  });
});

describe('an account signed in by its token cookie', () => {
  it("is the session console.session answers: the account, its fleet and the fleet's name, its scopes and when its token ends", async () => {
    const cookie = await signedInCookie();

    await expect(asBrowser(cookie).console.session.query()).resolves.toEqual({
      fleetId,
      fleetName: 'acme',
      kind: 'account',
      accountId: 'acc-mathilde',
      scopes: ['fleet:read', 'fleet:commission'],
      expiresAt: new Date(clock.now().getTime() + 600_000).toISOString(),
    });
  });

  it('is named by its id in console.account', async () => {
    await expect(asBrowser(await signedInCookie()).console.account.query()).resolves.toEqual({ kind: 'account', accountId: 'acc-mathilde' });
  });

  it("reads what fleet:read reads in the console: the fleet, a ship, its timeline, messages and way, needs attention, health, limits and argo's inbox", async () => {
    const fleet = asBrowser(await signedInCookie()).fleet;

    await expect(fleet.list.query({})).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ name: 'scout' })]));
    const ship = await fleet.ship.query({ shipId: scout });
    expect(ship).toMatchObject({ name: 'scout' });
    expect(ship).not.toHaveProperty('isInReadReach', false);
    await expect(fleet.shipTimeline.query({ shipId: scout })).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ type: 'ShipCommissioned' })]));
    await expect(fleet.shipMessages.query({ shipId: scout })).resolves.toEqual([expect.objectContaining({ id: toArgo })]);
    await expect(fleet.message.query({ messageId: toArgo })).resolves.toMatchObject({ payload: 'Review is done' });
    await expect(fleet.shipWay.query({ shipId: scout })).resolves.toMatchObject({ waiting: 0 });
    await expect(fleet.needsAttention.query()).resolves.toBeDefined();
    await expect(fleet.health.query()).resolves.toBeDefined();
    await expect(fleet.limits.query()).resolves.toBeDefined();
    await expect(fleet.inbox.query({ filter: 'all' })).resolves.toMatchObject([{ message: { id: toArgo } }]);
  });

  it('shows no notices and no guide yet', async () => {
    const console = asBrowser(await signedInCookie()).console;

    await expect(console.notices.query()).resolves.toEqual([]);
    await expect(console.guide.query()).resolves.toBeNull();
  });

  it("takes no lease: argo's sign-in and the console sessions stay as they are", async () => {
    const leasesBefore = await database.lease.count({ where: { fleetId } });

    await asBrowser(await signedInCookie()).fleet.list.query({});

    await expect(database.lease.count({ where: { fleetId } })).resolves.toBe(leasesBefore);
    await expect(database.consoleSession.count({ where: { fleetId } })).resolves.toBe(0);
  });

  it("changes the fleet from the console's origin, the event naming the account", async () => {
    const { shipId } = await asBrowser(await signedInCookie()).fleet.commission.mutate({ idempotencyKey: newKey(), name: 'lookout', type: 'reviewer' });

    await expect(database.event.findFirstOrThrow({ where: { fleetId, type: 'ShipCommissioned', shipId } })).resolves.toMatchObject({ actorKind: 'account', actorAccountId: 'acc-mathilde' });
  });

  it("refuses a change by the cookie from any other origin, as for argo's cookie", async () => {
    const cookie = await signedInCookie();

    await expect(codeOf(asBrowser(cookie, 'https://elsewhere.example').fleet.commission.mutate({ idempotencyKey: newKey(), name: 'intruder', type: 'reviewer' }))).resolves.toBe('FORBIDDEN');
    await expect(database.ship.count({ where: { fleetId, name: 'intruder' } })).resolves.toBe(0);
  });

  it('follows the fleet live over the WebSocket with the cookie', async () => {
    const cookie = await signedInCookie();
    const heard: string[] = [];
    const socket = new WebSocket(`${address.replace(/^http/, 'ws')}/trpc`, { headers: { cookie, origin: CONSOLE } });
    socket.on('message', (raw: Buffer) => {
      const answer = z.object({ result: z.object({ type: z.string() }).optional(), error: z.object({ data: z.object({ code: z.string() }) }).optional() }).parse(JSON.parse(raw.toString()));
      heard.push(answer.error?.data.code ?? answer.result?.type ?? 'other');
    });
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => {
        resolve();
      });
      socket.once('error', reject);
    });
    try {
      socket.send(JSON.stringify({ id: 1, method: 'subscription', params: { path: 'fleet.events', input: { lastEventId: null } } }));
      await expect.poll(() => heard).toContain('started');

      unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'heard-live', type: 'reviewer' }));

      await expect.poll(() => heard).toContain('data');
      expect(heard).not.toContain('UNAUTHORIZED');
    } finally {
      socket.close();
    }
  });

  it('is signed out by console.signOut, which clears the cookie', async () => {
    const cookie = await signedInCookie();

    const answer = await fetch(`${address}/trpc/console.signOut`, { method: 'POST', headers: { cookie, origin: CONSOLE, 'content-type': 'application/json' }, body: '{}' });

    expect(answer.headers.getSetCookie()).toContain('aeolus_account_token=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict');
  });
});
