import type { FleetId } from '@aeolus-fleet/common';
import { createTRPCClient, httpBatchLink, httpLink, TRPCClientError, type TRPCClient } from '@trpc/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createApp } from '../src/app.js';
import type { AppRouter } from '../src/index.js';
import { FLEET_URL } from './support/core-fixtures.js';
import { createMigratedDatabase } from './support/database.js';
import { newKey } from './support/keys.js';
import { createTestClock } from './support/postgres-core.js';

// Hosted sign-in from HTTP to Postgres and back: the installation issues a
// sign-in ticket, and the console redeems it once for a session cookie.

const INSTALLATION_TOKEN = 'aeolus_installation_test_0123456789abcdef';
const TWO_MINUTES_MS = 2 * 60 * 1000;
const clock = createTestClock('2026-10-04T12:00:00.000Z');

let database: PrismaClient;
let hosting: FastifyInstance;
let selfHosted: FastifyInstance;
let hostingAddress: string;
let selfHostedAddress: string;
let fleetId: FleetId;

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  hosting = createApp({ databaseUrl, publicUrl: FLEET_URL, clock, logger: false, installationToken: INSTALLATION_TOKEN });
  hostingAddress = await hosting.listen({ host: '127.0.0.1', port: 0 });
  selfHosted = createApp({ databaseUrl, publicUrl: FLEET_URL, clock, logger: false });
  selfHostedAddress = await selfHosted.listen({ host: '127.0.0.1', port: 0 });
  ({ fleetId } = await installation().fleets.create.mutate({ requestId: newKey(), name: 'hemma', operatorEmail: 'lena@example.com' }));
});

afterAll(async () => {
  await hosting.close();
  await selfHosted.close();
  await database.$disconnect();
});

function installation(address = hostingAddress): TRPCClient<AppRouter>['installation'] {
  return createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${address}/trpc`, headers: { 'x-aeolus-installation-token': INSTALLATION_TOKEN } })] }).installation;
}

/** Redeems the ticket as the console's server does, and answers the session cookie it was given, or the refusal's code. */
async function redeem(ticket: string): Promise<{ cookie: string } | { code: string | undefined }> {
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
  try {
    await client.console.redeemSignInTicket.mutate({ ticket });
    return { cookie };
  } catch (error) {
    if (error instanceof TRPCClientError) {
      return { code: z.object({ code: z.string() }).safeParse(error.data).data?.code };
    }
    throw error;
  }
}

/** The signed-in account a session cookie gives. */
function accountWith(cookie: string) {
  return createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${hostingAddress}/trpc`, headers: { cookie } })] }).console.account.query();
}

describe('a sign-in ticket', () => {
  it("signs the fleet's operator in: the console gets a session cookie crewing argo, named for the device", async () => {
    const { ticket } = await installation().operators.issueSignInTicket.mutate({ fleetId });

    const redeemed = await redeem(ticket);

    const cookie = 'cookie' in redeemed ? redeemed.cookie : '';
    expect(cookie).toMatch(/^aeolus_session=.+/);
    await expect(accountWith(cookie)).resolves.toMatchObject({ email: 'lena@example.com', session: { device: 'Mac · Safari' } });
  });

  it('signs in once and never again', async () => {
    const { ticket } = await installation().operators.issueSignInTicket.mutate({ fleetId });
    await redeem(ticket);

    await expect(redeem(ticket)).resolves.toEqual({ code: 'UNAUTHORIZED' });
  });

  it('signs in once however many redeems race for it', async () => {
    const { ticket } = await installation().operators.issueSignInTicket.mutate({ fleetId });

    const redeemed = await Promise.all(Array.from({ length: 5 }, () => redeem(ticket)));

    expect(redeemed.filter((result) => 'cookie' in result)).toHaveLength(1);
    await expect(database.signInTicket.count({ where: { usedAt: { not: null } } })).resolves.toBeGreaterThan(0);
  });

  it('expires 2 minutes after it was issued', async () => {
    const { ticket } = await installation().operators.issueSignInTicket.mutate({ fleetId });
    clock.advance(TWO_MINUTES_MS);

    await expect(redeem(ticket)).resolves.toEqual({ code: 'UNAUTHORIZED' });
  });

  it('is stored as its hash only', async () => {
    const { ticket } = await installation().operators.issueSignInTicket.mutate({ fleetId });

    const rows = await database.signInTicket.findMany();
    expect(JSON.stringify(rows)).not.toContain(ticket);
  });

  it('is not issued by a server without an installation token', async () => {
    await expect(installation(selfHostedAddress).operators.issueSignInTicket.mutate({ fleetId }).catch((error: unknown) => (error instanceof TRPCClientError ? z.object({ code: z.string() }).parse(error.data).code : error))).resolves.toBe('NOT_FOUND');
  });
});
