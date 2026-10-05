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

// The guide from HTTP to Postgres and back (decision 0024): the installation
// sets it, each console session of its audience reads it with where it is,
// and records its progress for itself.

const INSTALLATION_TOKEN = 'aeolus_installation_test_0123456789abcdef';
const CONSOLE = new URL(FLEET_URL).origin;

let database: PrismaClient;
let hosting: FastifyInstance;
let address: string;
let fleetId: FleetId;

const steps = [
  { path: '/', anchor: 'fleet-table', title: 'Your fleet', text: 'Every ship, its type and who crews it.' },
  { path: '/squadrons', title: 'The squadron', text: 'A team of ships formed from a blueprint.' },
];
const guide = { audience: 'viewers' as const, steps };

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  hosting = createApp({ databaseUrl, publicUrl: FLEET_URL, logger: false, installationToken: INSTALLATION_TOKEN });
  address = await hosting.listen({ host: '127.0.0.1', port: 0 });
  ({ fleetId } = await installation().fleets.create.mutate({ requestId: newKey(), name: 'demo', operatorEmail: 'demo@example.com', viewer: true }));
});

beforeEach(async () => {
  await installation().guide.set.mutate({ guide });
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
  it('reads back the guide it set', async () => {
    await expect(installation().guide.get.query()).resolves.toEqual({ guide });
  });

  it('clears it by setting none', async () => {
    await installation().guide.set.mutate({ guide: null });

    await expect(installation().guide.get.query()).resolves.toEqual({ guide: null });
  });

  it('is refused a guide the schema does not take', async () => {
    await expect(codeOf(installation().guide.set.mutate({ guide: { ...guide, steps: [] } }))).resolves.toBe('BAD_REQUEST');
  });
});

describe('a console session', () => {
  it('of its audience reads the guide open at its first step; another reads none', async () => {
    await expect((await signIn('viewer')).console.guide.query()).resolves.toEqual({ steps, progress: { step: 0, state: 'open' } });
    await expect((await signIn('operator')).console.guide.query()).resolves.toBeNull();
  });

  it('records its progress for itself only, and records it again over the last', async () => {
    const viewer = await signIn('viewer');
    const other = await signIn('viewer');

    await viewer.console.recordGuideProgress.mutate({ step: 1, state: 'open' });
    await viewer.console.recordGuideProgress.mutate({ step: 1, state: 'finished' });

    await expect(viewer.console.guide.query()).resolves.toEqual({ steps, progress: { step: 1, state: 'finished' } });
    await expect(other.console.guide.query()).resolves.toEqual({ steps, progress: { step: 0, state: 'open' } });
  });

  it('is refused a step the guide does not have, or progress in a guide not for it', async () => {
    await expect(codeOf((await signIn('viewer')).console.recordGuideProgress.mutate({ step: 2, state: 'open' }))).resolves.toBe('BAD_REQUEST');
    await expect(codeOf((await signIn('operator')).console.recordGuideProgress.mutate({ step: 0, state: 'open' }))).resolves.toBe('NOT_FOUND');
  });

  it("reads no guide without a session, and its progress goes with its fleet's delete", async () => {
    await expect(codeOf(consoleWith('aeolus_session=forged').console.guide.query())).resolves.toBe('UNAUTHORIZED');
    const viewer = await signIn('viewer');
    await viewer.console.recordGuideProgress.mutate({ step: 1, state: 'skipped' });

    await installation().fleets.delete.mutate({ requestId: newKey(), fleetId });

    await expect(database.guideProgress.count({ where: { fleetId } })).resolves.toBe(0);
    ({ fleetId } = await installation().fleets.create.mutate({ requestId: newKey(), name: 'demo-2', operatorEmail: `demo-${newKey().slice(0, 6)}@example.com`, viewer: true }));
  });
});
