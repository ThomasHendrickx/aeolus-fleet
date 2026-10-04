import { SCOPES } from '@aeolus-fleet/common';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../packages/server/src/adapters/prisma/client.js';
import { createApp } from '../packages/server/src/app.js';
import type { Caller } from '../packages/server/src/core/shared/caller.js';
import type { AppRouter } from '../packages/server/src/index.js';
import { createUseCases, type UseCases } from '../packages/server/src/wiring.js';
import { FLEET_URL, OPERATOR } from '../packages/server/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../packages/server/test/support/database.js';
import { newKey } from '../packages/server/test/support/keys.js';
import { createTestClock } from '../packages/server/test/support/postgres-core.js';
import { unwrap } from '../packages/server/test/support/result.js';
import { signIn } from './support/console.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';

// The console at its fleet's limits, end to end: the installation sets them,
// and the console says so where the operator acts (canvas 12.1 to 12.3). The
// console is hosted: its account menu links to the hosting service's account.

const INSTALLATION_TOKEN = 'aeolus_installation_test_0123456789abcdef';
const ACCOUNT_URL = 'https://pagasae.example.com/account';
const clock = createTestClock('2026-10-04T12:00:00.000Z');

let database: PrismaClient;
let core: UseCases;
let argo: Caller;
let fleetId: string;
let server: FastifyInstance;
let serverUrl: string;
let web: RunningWeb;
let browser: Browser;
const contexts: BrowserContext[] = [];

function installation() {
  return createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${serverUrl}/trpc`, headers: { 'x-aeolus-installation-token': INSTALLATION_TOKEN } })] }).installation;
}

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  core = createUseCases({ prisma: database, clock });
  const fleet = unwrap(await core.initialiseFleet({ name: 'home fleet', ...OPERATOR }));
  fleetId = fleet.fleetId;
  argo = { fleetId: fleet.fleetId, shipId: fleet.operatorShipId, kind: 'operator', scopes: [...SCOPES] };
  const webUrl = await reserveWebUrl();
  server = createApp({ databaseUrl, publicUrl: FLEET_URL, consoleOrigin: webUrl, clock, logger: false, installationToken: INSTALLATION_TOKEN });
  serverUrl = await server.listen({ host: '127.0.0.1', port: 0 });
  web = await startWeb({ url: webUrl, serverUrl, hostedAccountUrl: ACCOUNT_URL });
  browser = await launchChromium();
});

afterAll(async () => {
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
  await web.stop();
  await server.close();
  await database.$disconnect();
});

async function signedInPage(): Promise<Page> {
  const context = await browser.newContext({ baseURL: web.url });
  contexts.push(context);
  const page = await context.newPage();
  clock.advance(60_000);
  await signIn(page, OPERATOR);
  await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
  return page;
}

describe('a hosted console', () => {
  it('offers Your account in the account menu, opening the hosting service\'s account page', async () => {
    const page = await signedInPage();

    await page.locator('[data-testid="account-menu"]:visible').click();

    const link = page.locator('[data-testid="account-hosted"]:visible');
    await expect(link.textContent()).resolves.toBe('Your account');
    await expect(link.getAttribute('href')).resolves.toBe(ACCOUNT_URL);
  });
});

describe('a console at its limits', () => {
  it('says in Commission that the fleet is at its ship limit, with View limits, and commissions nothing', async () => {
    unwrap(await core.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
    await installation().fleets.setLimits.mutate({ fleetId, ships: { kind: 'fleet', limit: 2 } });
    const page = await signedInPage();

    await page.getByTestId('fleet-commission').click();

    const notice = page.getByTestId('commission-ship-limit');
    await notice.getByText('Your fleet is at its ship limit').waitFor();
    await expect(notice.getByTestId('commission-ship-limit-view').getAttribute('href')).resolves.toBe(ACCOUNT_URL);
    await expect(page.getByTestId('commission-submit').isDisabled()).resolves.toBe(true);
  });

  it("shows on the overview that today's message limit is reached, and Compose says the message wasn't sent", async () => {
    await installation().fleets.setLimits.mutate({ fleetId, dailyMessages: { kind: 'fleet', limit: 1 } });
    unwrap(await core.sendMessage(argo, { selector: { kind: 'ship', name: 'argo' }, payload: 'Note', idempotencyKey: newKey() }));
    const page = await signedInPage();

    await page.getByTestId('overview-message-limit').getByText('Your fleet reached today’s message limit').waitFor();

    await page.getByTestId('header-compose').click();
    const dialog = page.getByTestId('compose-dialog');
    await dialog.getByTestId('compose-ship').fill('sco');
    await page.getByRole('option', { name: /scout/ }).click();
    await dialog.getByTestId('compose-payload').fill('Review it');
    await dialog.getByTestId('compose-send').click();

    await page.getByTestId('compose-message-limit').getByText('This message wasn’t sent').waitFor();
  });
});
