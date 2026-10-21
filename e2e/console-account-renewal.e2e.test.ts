import type { FleetId } from '@aeolus-fleet/common';
import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../packages/core/src/adapters/prisma/client.js';
import { createApp } from '../packages/core/src/app.js';
import { createMigratedDatabase } from '../packages/core/src/testing/database.js';
import { newKey } from '../packages/core/src/testing/keys.js';
import { unwrap } from '../packages/core/src/testing/result.js';
import { createUseCases, type UseCases } from '../packages/core/src/wiring.js';
import type { ShipCaller } from '../packages/core/src/domain/shared/caller.js';
import { OPERATOR, FLEET_URL, operatorCaller } from '../packages/core/test/support/core-fixtures.js';
import { startFakePagasae, type FakeAccount, type FakePagasae } from './support/fake-pagasae.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';

// An account's sign-in across its token's end (accounts design, F2, F6, F7;
// A3 to A6): the console renews the token with the shared sign-in a little
// before it ends, live updates go on, the pages follow the scopes the fresh
// token carries, pagasae not answering is said and retried, and a sign-in
// pagasae ended is said, keeping the page's address. pagasae is the fake one;
// its tokens last 125 seconds here, so the renewal comes within seconds.

const TOKEN_SECONDS = 125;
const RENEWAL_WAIT_MS = 30_000;

let database: PrismaClient;
let useCases: UseCases;
let pagasae: FakePagasae;
let server: FastifyInstance;
let web: RunningWeb;
let browser: Browser;
let fleetId: FleetId;
let argo: ShipCaller;
const contexts: BrowserContext[] = [];

function mathilde(scopes: readonly string[] = ['fleet:read', 'fleet:manage', 'labels:define']): FakeAccount {
  return { id: 'acc-mathilde', email: 'mathilde@acme.example', fleets: [{ id: fleetId, name: 'home fleet', scopes }] };
}

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  useCases = createUseCases({ prisma: database });
  const fleet = unwrap(await useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR }));
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);

  pagasae = await startFakePagasae();
  const webUrl = await reserveWebUrl();
  server = createApp({ databaseUrl, publicUrl: FLEET_URL, consoleOrigin: webUrl, logger: false, accountTokenIssuer: pagasae.url });
  const serverUrl = await server.listen({ host: '127.0.0.1', port: 0 });
  web = await startWeb({ url: webUrl, serverUrl, pagasae });
  browser = await launchChromium();
});

afterEach(() => {
  pagasae.setDown(false);
  pagasae.issueTokensFor(600);
});

afterAll(async () => {
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
  await web.stop();
  await server.close();
  await pagasae.close();
  await database.$disconnect();
});

async function newPage({ canRunScripts = true }: { canRunScripts?: boolean } = {}): Promise<Page> {
  const context = await browser.newContext({ baseURL: web.url, javaScriptEnabled: canRunScripts });
  contexts.push(context);
  return context.newPage();
}

async function tokenCookieOf(page: Page): Promise<string | undefined> {
  return (await page.context().cookies()).find(({ name }) => name === 'aeolus_account_token')?.value;
}

/** Waits until the browser holds another token cookie than the one given. */
async function renewedFrom(page: Page, before: string | undefined): Promise<void> {
  await expect.poll(() => tokenCookieOf(page), { timeout: RENEWAL_WAIT_MS, interval: 500 }).not.toBe(before);
}

describe("an account's token renewed in the browser", () => {
  it('is renewed before it ends, and live updates go on with the fresh token', async () => {
    pagasae.signInAs(mathilde());
    pagasae.issueTokensFor(TOKEN_SECONDS);
    const page = await newPage();
    await page.goto('/');
    await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
    const before = await tokenCookieOf(page);

    await renewedFrom(page, before);
    unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'renewed-scout', type: 'reviewer' }));

    await page.getByRole('link', { name: 'renewed-scout' }).first().waitFor();
    await page.locator('[data-slot="live-status"]:visible', { hasText: 'Live' }).first().waitFor();
  });

  it('follows the scopes the fresh token carries: a right taken away goes from the page', async () => {
    pagasae.signInAs(mathilde());
    pagasae.issueTokensFor(TOKEN_SECONDS);
    const page = await newPage();
    await page.goto('/');
    await page.getByTestId('overview-labels').getByText('Manage labels').waitFor();
    const before = await tokenCookieOf(page);

    pagasae.changeScopes({ accountId: 'acc-mathilde', fleetId, scopes: ['fleet:read'] });
    await renewedFrom(page, before);

    await page.getByTestId('overview-labels').getByText('View labels').waitFor();
  });

  it('says it cannot reach the sign-in service and retries, the page working meanwhile', async () => {
    pagasae.signInAs(mathilde());
    pagasae.issueTokensFor(TOKEN_SECONDS);
    const page = await newPage();
    await page.goto('/');
    await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
    const before = await tokenCookieOf(page);

    pagasae.setDown(true);
    await page.getByText('Can’t reach the sign-in service. Retrying.').waitFor({ timeout: RENEWAL_WAIT_MS });
    await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
    pagasae.setDown(false);

    await renewedFrom(page, before);
    await page.getByText('Can’t reach the sign-in service. Retrying.').waitFor({ state: 'detached', timeout: RENEWAL_WAIT_MS });
  });

  it("says the sign-in ended when pagasae refuses the renewal, keeping the page's address", async () => {
    pagasae.signInAs(mathilde());
    pagasae.issueTokensFor(TOKEN_SECONDS);
    const page = await newPage();
    await page.goto('/labels');
    await page.getByRole('heading', { name: 'Labels' }).waitFor();

    pagasae.endSignIns();

    await page.waitForURL(`${web.url}/sign-in?notice=ended&returnTo=%2Flabels`, { timeout: RENEWAL_WAIT_MS });
    await page.getByText('Your sign-in ended.').waitFor();
    await expect(page.getByTestId('sign-in-account-start').getAttribute('href')).resolves.toBe('/sign-in/start?returnTo=%2Flabels');
  });
});

describe("an account's token renewed on a page load", () => {
  it('is renewed by the console before the page renders once it is within two minutes of its end', async () => {
    pagasae.signInAs(mathilde());
    pagasae.issueTokensFor(TOKEN_SECONDS - 10);
    // No script runs: only the console's server can renew.
    const page = await newPage({ canRunScripts: false });
    await page.goto('/');
    await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
    const before = await tokenCookieOf(page);
    const issued = pagasae.tokensIssued();

    await page.goto('/labels');

    await page.getByRole('heading', { name: 'Labels' }).waitFor();
    expect(pagasae.tokensIssued()).toBeGreaterThan(issued);
    expect(await tokenCookieOf(page)).not.toBe(before);
  });
});
