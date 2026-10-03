import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createPrismaClient, type PrismaClient } from '../packages/server/src/adapters/prisma/client.js';
import { createApp } from '../packages/server/src/app.js';
import type { Caller } from '../packages/server/src/core/shared/caller.js';
import { createUseCases, type UseCases } from '../packages/server/src/wiring.js';
import { FLEET_URL, OPERATOR, operatorCaller, secretIn } from '../packages/server/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../packages/server/test/support/database.js';
import { createTestClock } from '../packages/server/test/support/postgres-core.js';
import { unwrap } from '../packages/server/test/support/result.js';
import { signIn } from './support/console.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';
import { newKey } from '../packages/server/test/support/keys.js';

// Last seen and the crew's report, end to end: a ship's session calls the
// fleet over the REST API, and the overview and its page say when it was last
// seen, and what it reported; when the session stops calling, the time ages.

const clock = createTestClock('2026-10-01T09:00:00.000Z');
/** A receive returns at once when it has deliveries; an empty one waits no longer than this. */
const RECEIVE_WAIT_MS = 500;
/** Sign-ins are rate limited per window; each test signs in after the window of the one before. */
const SIGN_IN_WINDOW_MS = 60_000;

let database: PrismaClient;
let useCases: UseCases;
let argo: Caller;
let server: FastifyInstance;
let serverUrl: string;
let web: RunningWeb;
let browser: Browser;
const contexts: BrowserContext[] = [];

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  useCases = createUseCases({ prisma: database, clock, fleetUrl: FLEET_URL });
  argo = operatorCaller(unwrap(await useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR })));

  const webUrl = await reserveWebUrl();
  server = createApp({
    databaseUrl,
    publicUrl: FLEET_URL,
    consoleOrigin: webUrl,
    clock,
    logger: false,
    receiveWaitMs: RECEIVE_WAIT_MS,
  });
  serverUrl = await server.listen({ host: '127.0.0.1', port: 0 });
  web = await startWeb({ url: webUrl, serverUrl });
  browser = await launchChromium();
});

afterAll(async () => {
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
  await web.stop();
  await server.close();
  await database.$disconnect();
});

/** A ship's session on the REST API, as its starting prompt tells it to connect. */
interface Session {
  shipId: string;
  call(operation: 'send' | 'receive' | 'ack' | 'report', body: Record<string, unknown>): Promise<unknown>;
}

async function crewedOverRest(ship: { name: string; type: string }): Promise<Session> {
  const { shipId, prompt } = unwrap(await useCases.commissionShip(argo, { ...ship, idempotencyKey: newKey() }));
  const registered = await fetch(`${serverUrl}/api/v1/ship/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ shipId, secret: secretIn(prompt), location: { kind: 'DEVICE' } }),
  });
  const { crewToken } = z.object({ crewToken: z.string() }).parse(await registered.json());
  return {
    shipId,
    call: async (operation, body) => {
      const response = await fetch(`${serverUrl}/api/v1/ship/${operation}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${crewToken}` },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(200);
      return response.json();
    },
  };
}


async function signedInPage(): Promise<Page> {
  clock.advance(SIGN_IN_WINDOW_MS);
  const context = await browser.newContext({ baseURL: web.url });
  contexts.push(context);
  const page = await context.newPage();
  await signIn(page, OPERATOR);
  await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
  return page;
}

describe('last seen', () => {
  it("shows a crewed ship's last call in the overview and on its page, and lets it age once the session stops", async () => {
    const scout = await crewedOverRest({ name: 'scout', type: 'reviewer' });
    const page = await signedInPage();
    await scout.call('receive', {});
    const calledAt = clock.now();

    // The browser's clock follows the server's test clock.
    await page.clock.setFixedTime(new Date(calledAt.getTime() + 20_000));
    await page.reload();
    await page.getByTestId('fleet-row-scout').getByText('Last seen 20 s ago').waitFor();
    await page.goto(`/ships/${scout.shipId}`);
    await page.getByTestId('ship-last-seen').getByText('Last seen 20 s ago').waitFor();

    await page.clock.setFixedTime(new Date(calledAt.getTime() + 6 * 60_000));
    await page.reload();
    await page.getByTestId('ship-last-seen').getByText('Last seen 6 min ago').waitFor();
  });
});

describe("a crew's report", () => {
  it('shows what the crew reported on its page, live, and in the overview', async () => {
    const lookout = await crewedOverRest({ name: 'lookout', type: 'reviewer' });
    const page = await signedInPage();
    await page.clock.setFixedTime(new Date(clock.now().getTime() + 5_000));
    await page.goto(`/ships/${lookout.shipId}`);
    await page.getByTestId('ship-header').waitFor();

    await lookout.call('report', { state: 'blocked', note: 'waiting for review' });

    const report = page.getByTestId('ship-report');
    await report.getByText('waiting for review').waitFor({ timeout: 20_000 });
    await expect(report.getAttribute('title')).resolves.toBe('Blocked: waiting for review');
    await report.getByText('· reported just now').waitFor();
    await page.goto('/');
    await page.getByTestId('fleet-row-lookout').getByTestId('fleet-report').getByText('waiting for review').waitFor();
  });
});
