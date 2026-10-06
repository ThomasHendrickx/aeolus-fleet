import { idSchema, SCOPES, type FleetId } from '@aeolus-fleet/common';
import { createTRPCClient, httpBatchLink, httpLink, TRPCClientError, type TRPCClient } from '@trpc/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createApp } from '../src/app.js';
import type { AppRouter } from '../src/index.js';
import { createUseCases } from '../src/wiring.js';
import { FLEET_URL, modelOf, secretOf } from './support/core-fixtures.js';
import { createMigratedDatabase } from './support/database.js';
import { newKey } from './support/keys.js';
import { createTestClock } from './support/postgres-core.js';
import { unwrap } from './support/result.js';

// The viewer ship from HTTP to Postgres and back (decision 0022): the
// installation creates a fleet with one and issues viewer tickets; each
// redeems to a viewer session that reads the fleet only, many at once beside
// the operator's, valid 2 hours after its last use and 24 hours at most.

const CONSOLE = new URL(FLEET_URL).origin;
const INSTALLATION_TOKEN = 'aeolus_installation_test_0123456789abcdef';
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const clock = createTestClock('2026-10-05T09:00:00.000Z');

let database: PrismaClient;
let hosting: FastifyInstance;
let hostingAddress: string;
let demoFleet: FleetId;
let plainFleet: FleetId;

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  hosting = createApp({ databaseUrl, publicUrl: FLEET_URL, clock, logger: false, installationToken: INSTALLATION_TOKEN });
  hostingAddress = await hosting.listen({ host: '127.0.0.1', port: 0 });
  ({ fleetId: demoFleet } = await installation().fleets.create.mutate({ requestId: newKey(), name: 'demo', operatorEmail: 'demo@example.com', viewer: true }));
  ({ fleetId: plainFleet } = await installation().fleets.create.mutate({ requestId: newKey(), name: 'hemma', operatorEmail: 'lena@example.com' }));
});

afterAll(async () => {
  await hosting.close();
  await database.$disconnect();
});

function installation(): TRPCClient<AppRouter>['installation'] {
  return createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${hostingAddress}/trpc`, headers: { 'x-aeolus-installation-token': INSTALLATION_TOKEN } })] }).installation;
}

/** The console, as a browser on its origin holding the session cookie. */
function consoleWith(cookie: string): TRPCClient<AppRouter> {
  return createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${hostingAddress}/trpc`, headers: { cookie, origin: CONSOLE } })] });
}

/** The tRPC error code a call fails with; undefined when it succeeds. */
async function codeOf(call: Promise<unknown>): Promise<string | undefined> {
  try {
    await call;
  } catch (error) {
    if (error instanceof TRPCClientError) {
      return z.object({ code: z.string() }).safeParse(error.data).data?.code;
    }
    throw error;
  }
  return undefined;
}

/** Issues a ticket for the fleet and redeems it as the console's server does, answering the session cookie. */
async function signIn(fleetId: FleetId, as: 'operator' | 'viewer'): Promise<string> {
  const { ticket } = await installation().operators.issueSignInTicket.mutate({ fleetId, as });
  let cookie = '';
  const client = createTRPCClient<AppRouter>({
    links: [
      httpLink({
        url: `${hostingAddress}/trpc`,
        headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15' },
        fetch: async (...call: Parameters<typeof fetch>) => {
          const response = await fetch(...call);
          cookie = response.headers.get('set-cookie')?.split(';')[0] ?? '';
          return response;
        },
      }),
    ],
  });
  await client.console.redeemSignInTicket.mutate({ ticket });
  return cookie;
}

describe('a fleet the installation creates with a viewer', () => {
  it('has the viewer ship: named viewer, crewed, reading the fleet only', async () => {
    const cookie = await signIn(demoFleet, 'operator');

    const ships = await consoleWith(cookie).fleet.list.query();

    expect(ships.find((ship) => ship.kind === 'viewer')).toMatchObject({ name: 'viewer', type: 'viewer', status: 'crewed', scopes: ['fleet:read'] });
  });

  it('has one viewer ship at most: Postgres refuses a second', async () => {
    const viewer = await database.ship.findFirstOrThrow({ where: { fleetId: demoFleet, kind: 'viewer' } });

    await expect(database.ship.create({ data: { ...viewer, id: `shp_${newKey().slice(0, 26)}`, name: 'viewer-2' } })).rejects.toThrow(/Unique constraint/);
  });
});

describe('a viewer ticket', () => {
  it('signs a viewer in: console.session answers its kind, its scopes and an expiry 2 hours on', async () => {
    const cookie = await signIn(demoFleet, 'viewer');

    await expect(consoleWith(cookie).console.session.query()).resolves.toEqual({
      fleetId: demoFleet,
      kind: 'viewer',
      scopes: ['fleet:read'],
      expiresAt: new Date(clock.now().getTime() + 2 * HOUR_MS).toISOString(),
    });
  });

  it('gives an account with its kind and session, and no email or theme', async () => {
    const cookie = await signIn(demoFleet, 'viewer');

    await expect(consoleWith(cookie).console.account.query()).resolves.toEqual({ kind: 'viewer', session: { device: 'Mac · Safari', since: clock.now().toISOString() } });
  });

  it('is refused for a fleet without a viewer ship', async () => {
    await expect(codeOf(installation().operators.issueSignInTicket.mutate({ fleetId: plainFleet, as: 'viewer' }))).resolves.toBe('NOT_FOUND');
  });
});

describe('viewer sessions on Postgres', () => {
  it('run many at once beside the operator, and the operator signing in again ends none of them', async () => {
    const viewers = [await signIn(demoFleet, 'viewer'), await signIn(demoFleet, 'viewer')];
    await signIn(demoFleet, 'operator');
    const operator = await signIn(demoFleet, 'operator');

    for (const cookie of [...viewers, operator]) {
      await expect(codeOf(consoleWith(cookie).console.session.query())).resolves.toBeUndefined();
    }
  });

  it('read the fleet and change nothing', async () => {
    const viewer = consoleWith(await signIn(demoFleet, 'viewer'));

    await expect(codeOf(viewer.fleet.list.query())).resolves.toBeUndefined();
    await expect(codeOf(viewer.fleet.commission.mutate({ idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }))).resolves.toBe('FORBIDDEN');
    await expect(codeOf(viewer.console.setTheme.mutate({ theme: 'dark' }))).resolves.toBe('FORBIDDEN');
  });

  it('stay valid 2 hours after their last use, and end 2 hours after it', async () => {
    const viewer = consoleWith(await signIn(demoFleet, 'viewer'));
    clock.advance(2 * HOUR_MS - MINUTE_MS);
    await viewer.console.session.query();
    clock.advance(2 * HOUR_MS - MINUTE_MS);

    await expect(codeOf(viewer.console.session.query())).resolves.toBeUndefined();
    clock.advance(2 * HOUR_MS);
    await expect(codeOf(viewer.console.session.query())).resolves.toBe('UNAUTHORIZED');
  });

  it('end 24 hours after they started, however often they are used', async () => {
    const viewer = consoleWith(await signIn(demoFleet, 'viewer'));
    const endsBy = new Date(clock.now().getTime() + 24 * HOUR_MS);
    for (let hour = 0; hour < 23; hour += 1) {
      clock.advance(HOUR_MS);
      await viewer.console.session.query();
    }

    await expect(viewer.console.session.query()).resolves.toMatchObject({ expiresAt: endsBy.toISOString() });
    clock.advance(HOUR_MS);
    await expect(codeOf(viewer.console.session.query())).resolves.toBe('UNAUTHORIZED');
  });

  it('sign out alone: the operator stays signed in', async () => {
    const operator = consoleWith(await signIn(demoFleet, 'operator'));
    const viewer = consoleWith(await signIn(demoFleet, 'viewer'));

    await viewer.console.signOut.mutate();

    await expect(codeOf(viewer.console.session.query())).resolves.toBe('UNAUTHORIZED');
    await expect(codeOf(operator.console.session.query())).resolves.toBeUndefined();
  });
});

describe('what a viewer session reads on Postgres', () => {
  it("reads argo's inbox through fleet.inbox, as the operator sees it", async () => {
    const core = createUseCases({ prisma: database, clock });
    const argoId = idSchema('ship').parse((await database.ship.findFirstOrThrow({ where: { fleetId: demoFleet, kind: 'operator' } })).id);
    const argo = { fleetId: demoFleet, shipId: argoId, kind: 'operator' as const, scopes: [...SCOPES] };
    const { shipId, secret } = unwrap(await core.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
    const { crewToken } = unwrap(await core.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'DEVICE' }, harness: 'claude-code' }));
    const scout = unwrap(await core.authenticate.byCrewToken(crewToken));
    unwrap(await core.sendMessage(scout, { ...modelOf(scout), selector: { kind: 'ship', shipId: argoId }, payload: 'Run 71 passed', idempotencyKey: newKey() }));
    const viewer = consoleWith(await signIn(demoFleet, 'viewer'));
    const operator = consoleWith(await signIn(demoFleet, 'operator'));

    const seen = await viewer.fleet.inbox.query({ filter: 'all' });

    expect(seen.map((entry) => entry.message.payload)).toEqual(['Run 71 passed']);
    expect(seen).toEqual(await operator.fleet.inbox.query({ filter: 'all' }));
  });

  it('lists the viewer ship last seen when its most recent viewer session was used', async () => {
    const first = consoleWith(await signIn(demoFleet, 'viewer'));
    clock.advance(10 * MINUTE_MS);
    await signIn(demoFleet, 'viewer');
    clock.advance(5 * MINUTE_MS);
    const usedAt = clock.now();
    await first.console.session.query();

    const ships = await first.fleet.list.query();

    expect(ships.find((ship) => ship.kind === 'viewer')).toMatchObject({ status: 'crewed', lastSeenAt: usedAt.toISOString(), location: null });
  });
});
