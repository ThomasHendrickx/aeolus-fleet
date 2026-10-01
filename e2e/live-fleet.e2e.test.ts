import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Page, WebSocketRoute } from 'playwright';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../packages/server/src/adapters/prisma/client.js';
import { createApp } from '../packages/server/src/app.js';
import type { Caller } from '../packages/server/src/core/shared/caller.js';
import { createUseCases, type UseCases } from '../packages/server/src/wiring.js';
import { FLEET_URL, OPERATOR, operatorCaller, secretIn, shipIdIn } from '../packages/server/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../packages/server/test/support/database.js';
import { createTestClock } from '../packages/server/test/support/postgres-core.js';
import { unwrap } from '../packages/server/test/support/result.js';
import { signIn } from './support/console.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';

// The fleet overview follows the fleet live, end to end: what happens in one
// browser, or through the API, shows in another browser of the same console
// session without a reload, and a browser whose connection drops misses
// nothing once it is back.

const clock = createTestClock('2026-10-01T09:00:00.000Z');
/** A live change shows within this; a reconnect may first wait out tRPC's backoff. */
const LIVE_TIMEOUT_MS = 20_000;

let database: PrismaClient;
let useCases: UseCases;
let argo: Caller;
let server: FastifyInstance;
let web: RunningWeb;
let browser: Browser;
const contexts: BrowserContext[] = [];

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  useCases = createUseCases({ prisma: database, clock, fleetUrl: FLEET_URL });
  argo = operatorCaller(unwrap(await useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR })));

  const webUrl = await reserveWebUrl();
  server = createApp({ databaseUrl, publicUrl: FLEET_URL, consoleOrigin: webUrl, clock, logger: false });
  const serverUrl = await server.listen({ host: '127.0.0.1', port: 0 });
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

async function newContext(): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: web.url });
  contexts.push(context);
  return context;
}

/**
 * Two browsers on one console session: the operator signs in in the first,
 * and the second carries the same session cookie. Signing in again would end
 * the first session, as there is one at a time.
 */
async function twoBrowsers(): Promise<{ first: Page; second: Page }> {
  const firstContext = await newContext();
  const first = await firstContext.newPage();
  await signIn(first, OPERATOR);
  await first.getByRole('heading', { name: 'Fleet overview' }).waitFor();

  const secondContext = await newContext();
  await secondContext.addCookies(await firstContext.cookies());
  const second = await secondContext.newPage();
  await second.goto('/');
  await second.getByRole('heading', { name: 'Fleet overview' }).waitFor();
  await isLive(first);
  await isLive(second);
  return { first, second };
}

function shipRow(page: Page, name: string) {
  return page.getByTestId(`fleet-row-${name}`);
}

/** The live dot in the header, with its word. */
async function isLive(page: Page): Promise<void> {
  await page.getByRole('banner').getByText('Live', { exact: true }).waitFor({ timeout: LIVE_TIMEOUT_MS });
}

async function commissionInConsole(page: Page, ship: { name: string; type: string }): Promise<string> {
  const form = page.getByTestId('commission-form');
  await form.getByLabel('Name').fill(ship.name);
  await form.getByLabel('Type').fill(ship.type);
  await form.getByRole('button', { name: 'Commission' }).click();
  const block = page.getByRole('region', { name: `Starting prompt for ${ship.name}` });
  const prompt = (await block.getByTestId('starting-prompt-text').textContent()) ?? '';
  await block.getByRole('button', { name: 'Done' }).click();
  return prompt;
}

describe('the live fleet overview', () => {
  it('shows a ship commissioned, claimed and released in one browser in a second browser, without a reload', async () => {
    const { first, second } = await twoBrowsers();

    const prompt = await commissionInConsole(first, { name: 'scout', type: 'reviewer' });
    const watched = shipRow(second, 'scout');
    await watched.getByText('Awaiting crew').waitFor({ timeout: LIVE_TIMEOUT_MS });
    await watched.and(second.locator('[data-new]')).waitFor();

    unwrap(await useCases.claimShip({ shipId: shipIdIn(prompt), secret: secretIn(prompt), location: { kind: 'CLOUD' } }));
    await watched.getByText('Crewed').waitFor({ timeout: LIVE_TIMEOUT_MS });
    await watched.getByText('Cloud').waitFor();

    const releasing = shipRow(first, 'scout');
    await releasing.getByText('Crewed').waitFor({ timeout: LIVE_TIMEOUT_MS });
    await releasing.getByTestId('fleet-ship-release').click();
    await first.getByTestId('release-dialog').getByRole('button', { name: 'Release ship' }).click();

    await watched.getByText('Awaiting crew').waitFor({ timeout: LIVE_TIMEOUT_MS });
    await watched.getByText('No starting prompt issued').waitFor();
  });

  it('misses no change while its connection was down: it shows each one once it is back', async () => {
    const context = await newContext();
    const page = await context.newPage();
    // Every WebSocket of the page goes through here, so the test can close the
    // live one; offline, the browser cannot open another until it is back.
    const sockets: WebSocketRoute[] = [];
    await page.routeWebSocket(/\/trpc$/, (socket) => {
      socket.connectToServer();
      sockets.push(socket);
    });
    await signIn(page, OPERATOR);
    await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
    await isLive(page);

    await context.setOffline(true);
    await Promise.all(sockets.splice(0).map((socket) => socket.close()));
    await page.getByRole('banner').getByText(/^(Reconnecting|Offline)$/).waitFor({ timeout: LIVE_TIMEOUT_MS });
    unwrap(await useCases.commissionShip(argo, { name: 'lookout', type: 'reviewer' }));
    const pilot = unwrap(await useCases.commissionShip(argo, { name: 'pilot', type: 'navigator' }));
    unwrap(await useCases.claimShip({ shipId: pilot.shipId, secret: secretIn(pilot.prompt), location: { kind: 'SERVER' } }));
    await context.setOffline(false);

    await isLive(page);
    await shipRow(page, 'lookout').getByText('Awaiting crew').waitFor({ timeout: LIVE_TIMEOUT_MS });
    await shipRow(page, 'pilot').getByText('Crewed').waitFor({ timeout: LIVE_TIMEOUT_MS });
    await shipRow(page, 'pilot').getByText('Server').waitFor();
  });
});
