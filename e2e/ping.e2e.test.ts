import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createPrismaClient, type PrismaClient } from '../packages/server/src/adapters/prisma/client.js';
import { createApp } from '../packages/server/src/app.js';
import type { Caller } from '../packages/server/src/core/shared/caller.js';
import { createUseCases, type UseCases } from '../packages/server/src/wiring.js';
import { FLEET_URL, OPERATOR, operatorCaller, secretOf } from '../packages/server/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../packages/server/test/support/database.js';
import { createTestClock } from '../packages/server/test/support/postgres-core.js';
import { unwrap } from '../packages/server/test/support/result.js';
import { signIn } from './support/console.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';
import { newKey } from '../packages/server/test/support/keys.js';

// Ping, end to end: the operator pings a crewed ship from its page, the
// ship's session receives the ping over the REST API and answers with pong,
// and the page, its timeline and the overview say the ping was answered.

const clock = createTestClock('2026-10-01T09:00:00.000Z');
/** A receive returns at once when it has deliveries; an empty one waits no longer than this. */
const RECEIVE_WAIT_MS = 500;
/** Sign-ins are rate limited per window; each test signs in after the window of the one before. */
const SIGN_IN_WINDOW_MS = 60_000;
/** A live change shows within this. */
const LIVE_TIMEOUT_MS = 20_000;

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
  useCases = createUseCases({ prisma: database, clock });
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
  call(operation: 'receive' | 'pong', body: Record<string, unknown>): Promise<unknown>;
}

async function crewedOverRest(ship: { name: string; type: string }): Promise<Session> {
  const { shipId, secret } = unwrap(await useCases.commissionShip(argo, { ...ship, idempotencyKey: newKey() }));
  const registered = await fetch(`${serverUrl}/api/v1/ship/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ shipId, secret: secretOf(secret), location: { kind: 'DEVICE' }, harness: 'claude-code' }),
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

const receivedSchema = z.object({
  deliveries: z.array(z.object({ deliveryId: z.string(), contentType: z.string() })),
});

async function signedInPage(): Promise<Page> {
  clock.advance(SIGN_IN_WINDOW_MS);
  const context = await browser.newContext({ baseURL: web.url });
  contexts.push(context);
  const page = await context.newPage();
  await signIn(page, OPERATOR);
  await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
  return page;
}

describe('ping', () => {
  it('pings a crewed ship from its page; its session answers with pong and the console says the ping was answered', async () => {
    const scout = await crewedOverRest({ name: 'scout', type: 'reviewer' });
    const page = await signedInPage();
    // The browser's clock follows the server's test clock.
    await page.clock.setFixedTime(new Date(clock.now().getTime() + 5_000));
    await page.goto(`/ships/${scout.shipId}`);

    await page.getByTestId('fleet-ship-ping').click();

    await page.getByTestId('ship-ping-status').getByText('Pinged just now, no answer yet').waitFor();
    const { deliveries } = receivedSchema.parse(await scout.call('receive', {}));
    expect(deliveries).toEqual([expect.objectContaining({ contentType: 'application/vnd.aeolus.ping' })]);
    clock.advance(4_000);
    await scout.call('pong', { deliveryId: deliveries[0]?.deliveryId });

    await page.getByTestId('ship-ping-status').getByText('Answered ping in 4 s').waitFor({ timeout: LIVE_TIMEOUT_MS });
    await page
      .getByTestId('ship-timeline-entry')
      .getByText('Answered a ping from argo with pong')
      .waitFor({ timeout: LIVE_TIMEOUT_MS });
  });

  it('shows the ping already waiting instead of sending another', async () => {
    const lookout = await crewedOverRest({ name: 'lookout', type: 'reviewer' });
    const page = await signedInPage();
    await page.clock.setFixedTime(new Date(clock.now().getTime() + 5_000));
    await page.goto(`/ships/${lookout.shipId}`);
    await page.getByTestId('fleet-ship-ping').click();
    await page.getByTestId('ship-ping-status').getByText('no answer yet', { exact: false }).waitFor();

    await page.getByTestId('fleet-ship-ping').click();

    await page.getByText('A ping already waits for lookout').waitFor();
    const { deliveries } = receivedSchema.parse(await lookout.call('receive', { max: 10 }));
    expect(deliveries).toHaveLength(1);
  });

  it('shows a ping that went undeliverable on the ship page', async () => {
    const pilot = await crewedOverRest({ name: 'pilot', type: 'reviewer' });
    const page = await signedInPage();
    await page.goto(`/ships/${pilot.shipId}`);
    await page.getByTestId('fleet-ship-ping').click();
    await page.getByTestId('ship-ping-status').getByText('no answer yet', { exact: false }).waitFor();

    // Handed out again and again, never acknowledged: it goes undeliverable.
    for (let claim = 1; claim <= 5; claim += 1) {
      await pilot.call('receive', {});
    }

    await page.reload();
    await page.getByTestId('ship-ping-status').getByText('Ping not answered: undeliverable').waitFor({ timeout: LIVE_TIMEOUT_MS });
  });
});

