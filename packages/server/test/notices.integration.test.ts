import type { FleetId } from '@aeolus-fleet/common';
import { createTRPCClient, httpBatchLink, httpLink, TRPCClientError, type TRPCClient } from '@trpc/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createApp } from '../src/app.js';
import type { AppRouter } from '../src/index.js';
import { FLEET_URL } from './support/core-fixtures.js';
import { createMigratedDatabase } from './support/database.js';
import { newKey } from './support/keys.js';

// Notices from HTTP to Postgres and back (decision 0023): the installation
// sets them, each console session reads those of its audience, and dismisses
// a dismissible one for itself.

const INSTALLATION_TOKEN = 'aeolus_installation_test_0123456789abcdef';
const CONSOLE = new URL(FLEET_URL).origin;

let database: PrismaClient;
let hosting: FastifyInstance;
let address: string;
let fleetId: FleetId;

const upgrade = { id: 'upgrade', audience: 'everyone' as const, text: 'Interruptions expected between 00:00 and 01:00.', links: [], isDismissible: false };
const welcome = { id: 'welcome', audience: 'viewers' as const, text: 'You are looking at a live fleet.', links: [{ label: 'Leave', url: 'https://pagasae.example.com', isSignOut: true }], isDismissible: true };
const limits = { id: 'limits', audience: 'operators' as const, text: 'Your fleet is near its ship limit.', links: [{ label: 'View limits', url: 'https://pagasae.example.com/account' }], isDismissible: true };

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  hosting = createApp({ databaseUrl, publicUrl: FLEET_URL, logger: false, installationToken: INSTALLATION_TOKEN });
  address = await hosting.listen({ host: '127.0.0.1', port: 0 });
  ({ fleetId } = await installation().fleets.create.mutate({ requestId: newKey(), name: 'demo', operatorEmail: 'demo@example.com', viewer: true }));
});

beforeEach(async () => {
  await installation().notices.set.mutate({ notices: [upgrade, welcome, limits] });
});

afterAll(async () => {
  await hosting.close();
  await database.$disconnect();
});

function installation(): TRPCClient<AppRouter>['installation'] {
  return createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${address}/trpc`, headers: { 'x-aeolus-installation-token': INSTALLATION_TOKEN } })] }).installation;
}

function consoleWith(cookie: string): TRPCClient<AppRouter> {
  return createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${address}/trpc`, headers: { cookie, origin: CONSOLE } })] });
}

async function signIn(as: 'operator' | 'viewer'): Promise<TRPCClient<AppRouter>> {
  const { ticket } = await installation().operators.issueSignInTicket.mutate({ fleetId, as });
  let cookie = '';
  const client = createTRPCClient<AppRouter>({
    links: [
      httpLink({
        url: `${address}/trpc`,
        fetch: async (...call: Parameters<typeof fetch>) => {
          const response = await fetch(...call);
          cookie = response.headers.get('set-cookie')?.split(';')[0] ?? '';
          return response;
        },
      }),
    ],
  });
  await client.console.redeemSignInTicket.mutate({ ticket });
  return consoleWith(cookie);
}

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

describe('the installation', () => {
  it('reads back the notices it set, in its order', async () => {
    await expect(installation().notices.get.query()).resolves.toEqual({ notices: [upgrade, welcome, limits] });
  });

  it('clears them by setting none', async () => {
    await installation().notices.set.mutate({ notices: [] });

    await expect(installation().notices.get.query()).resolves.toEqual({ notices: [] });
  });

  it('is refused a notice the schema does not take', async () => {
    await expect(codeOf(installation().notices.set.mutate({ notices: [{ ...upgrade, text: '' }] }))).resolves.toBe('BAD_REQUEST');
  });
});

describe('a console session', () => {
  it('reads the notices of its audience: the operator those for everyone and operators, a viewer those for everyone and viewers', async () => {
    await expect((await signIn('operator')).console.notices.query()).resolves.toEqual([upgrade, limits]);
    await expect((await signIn('viewer')).console.notices.query()).resolves.toEqual([upgrade, welcome]);
  });

  it('dismisses a dismissible notice for itself only, and keeps it dismissed', async () => {
    const viewer = await signIn('viewer');
    const other = await signIn('viewer');

    await viewer.console.dismissNotice.mutate({ noticeId: 'welcome' });
    await viewer.console.dismissNotice.mutate({ noticeId: 'welcome' });

    await expect(viewer.console.notices.query()).resolves.toEqual([upgrade]);
    await expect(other.console.notices.query()).resolves.toEqual([upgrade, welcome]);
  });

  it('is refused dismissing a notice that is not dismissible, or one it does not see', async () => {
    const operator = await signIn('operator');

    await expect(codeOf(operator.console.dismissNotice.mutate({ noticeId: 'upgrade' }))).resolves.toBe('BAD_REQUEST');
    await expect(codeOf(operator.console.dismissNotice.mutate({ noticeId: 'welcome' }))).resolves.toBe('NOT_FOUND');
  });

  it("reads no notices without a session, and its dismissals go with its fleet's delete", async () => {
    await expect(codeOf(consoleWith('aeolus_session=forged').console.notices.query())).resolves.toBe('UNAUTHORIZED');
    const viewer = await signIn('viewer');
    await viewer.console.dismissNotice.mutate({ noticeId: 'welcome' });

    await installation().fleets.delete.mutate({ requestId: newKey(), fleetId });

    await expect(database.noticeDismissal.count({ where: { fleetId } })).resolves.toBe(0);
    ({ fleetId } = await installation().fleets.create.mutate({ requestId: newKey(), name: 'demo-2', operatorEmail: `demo-${newKey().slice(0, 6)}@example.com`, viewer: true }));
  });
});
