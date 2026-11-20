import { accountIdSchema, idSchema, type FleetId } from '@aeolus-fleet/common';
import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../packages/core/src/adapters/prisma/client.js';
import { createApp } from '../packages/core/src/app.js';
import { createMigratedDatabase } from '../packages/core/src/testing/database.js';
import { newKey } from '../packages/core/src/testing/keys.js';
import { unwrap } from '../packages/core/src/testing/result.js';
import { createUseCases } from '../packages/core/src/wiring.js';
import { FLEET_URL } from '../packages/core/test/support/core-fixtures.js';
import { startFakeAccountApp, type FakeAccount, type FakeAccountApp } from './support/fake-account-app.js';
import { accountButton, openSettings } from './support/console.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';

// An account switches the console between two fleets of one organisation
// with the one sign-in it has (second fleet design; header design, H9): the
// console asks the account app for the other fleet's account token, never a new
// sign-in, and renews for the fleet in view from then on.

const ACCOUNT_URL = 'https://account.acme.example/account';

let database: PrismaClient;
let accountApp: FakeAccountApp;
let server: FastifyInstance;
let web: RunningWeb;
let browser: Browser;
let fleetA: FleetId;
let fleetB: FleetId;
const contexts: BrowserContext[] = [];

function mathilde(inB: { scopes: readonly string[]; isArgoAllowedInA?: boolean } = { scopes: ['fleet:read'] }): FakeAccount {
  return {
    id: 'acc-mathilde',
    email: 'mathilde@acme.example',
    fleets: [
      { id: fleetA, name: 'home fleet', scopes: ['fleet:read', 'fleet:manage'], isArgoAllowed: inB.isArgoAllowedInA ?? false },
      { id: fleetB, name: 'second fleet', scopes: inB.scopes },
    ],
  };
}

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  const useCases = createUseCases({ prisma: database });
  // Two fleets the installation creates, as the account app creates an organisation's fleets.
  ({ fleetId: fleetA } = unwrap(await useCases.createFleet({ requestId: newKey(), name: 'home fleet', operatorEmail: 'admin@acme.example' })));
  ({ fleetId: fleetB } = unwrap(await useCases.createFleet({ requestId: newKey(), name: 'second fleet', operatorEmail: 'admin-second@acme.example' })));

  const webUrl = await reserveWebUrl();
  accountApp = await startFakeAccountApp({
    accountUrl: ACCOUNT_URL,
    // The apps list names this console for every fleet, as a hosted installation runs one console for an organisation's fleets.
    consoleUrl: webUrl,
    argoTickets: async (forFleet, accountId) => unwrap(await useCases.issueSignInTicket({ fleetId: idSchema('fleet').parse(forFleet), account: { id: accountIdSchema.parse(accountId) } })).ticket,
  });
  server = createApp({ databaseUrl, publicUrl: FLEET_URL, consoleOrigin: webUrl, logger: false, accountTokenIssuer: accountApp.url });
  const serverUrl = await server.listen({ host: '127.0.0.1', port: 0 });
  web = await startWeb({ url: webUrl, serverUrl, accountApp });
  browser = await launchChromium();
});

afterAll(async () => {
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
  await web.stop();
  await server.close();
  await accountApp.close();
  await database.$disconnect();
});

/** A new browser signed in to the console in fleet A as the account, the page hydrated. */
async function signedInToA(who: FakeAccount): Promise<Page> {
  accountApp.signInAs(who);
  const context = await browser.newContext({ baseURL: web.url });
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(`/?fleet=${fleetA}`);
  await isHydrated(page);
  return page;
}

/** The overview shows live once the page is hydrated: a menu click before that does nothing. */
async function isHydrated(page: Page): Promise<void> {
  await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
  await page.locator('[data-slot="live-status"][data-state="live"]:visible').waitFor({ timeout: 20_000 });
}

/** The fleet the console's account token names, its audience. */
async function tokenFleetOf(page: Page): Promise<string | undefined> {
  const token = (await page.context().cookies()).find(({ name }) => name === 'aeolus_account_token')?.value;
  const payload = token?.split('.')[1];
  if (payload === undefined) {
    return undefined;
  }
  const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString());
  return typeof claims === 'object' && claims !== null && 'aud' in claims && typeof claims.aud === 'string' ? claims.aud : undefined;
}

/** The bar's Apps and fleets panel, opened. */
async function openFleets(page: Page): Promise<void> {
  await page.locator('[data-testid="app-switcher-launcher"]:visible').click();
}

/** The avatar menu says the page is signed in as the account itself, not as argo. */
async function isSignedInAsAccount(page: Page): Promise<void> {
  await accountButton(page, 'Account: Your account').click();
  await page.getByTestId('avatar-menu-signed-in-as').getByText('Signed in with your account').waitFor();
  await page.keyboard.press('Escape');
}

describe('switching the console between two fleets of one organisation', () => {
  it('opens fleet B from the Apps and fleets panel: Opening, then Console is open in fleet B, with the same sign-in, and renews for fleet B (H9)', async () => {
    // Given the account in the console in fleet A, the panel open
    const page = await signedInToA(mathilde());
    const signInsBefore = accountApp.signInsAsked();
    await openFleets(page);

    // When it chooses fleet B
    await page.getByRole('link', { name: 'second fleet' }).click();

    // Then the row says it is opening, and the console arrives in fleet B and says so, focus on the launcher
    await page.getByText('Opening second fleet').first().waitFor();
    await page.getByText('Console is open in second fleet.').waitFor({ timeout: 20_000 });
    await isHydrated(page);
    await expect(page.locator('[data-testid="app-switcher-fleet-pill"]:visible').getAttribute('title')).resolves.toContain('second fleet');
    await expect.poll(() => page.getByRole('button', { name: 'Apps and fleets' }).and(page.locator(':focus')).count()).toBe(1);
    expect(accountApp.signInsAsked()).toBe(signInsBefore);
    expect(await tokenFleetOf(page)).toBe(fleetB);
    const renewal = await page.request.post('/sign-in/renew', { headers: { origin: web.url } });
    expect(renewal.status()).toBe(200);
    expect(await tokenFleetOf(page)).toBe(fleetB);
  });

  it("says it couldn't open fleet B while the account app does not answer, keeps the console in fleet A, and Try again opens it", async () => {
    // Given the account in the console in fleet A, the panel open, the account app down
    const page = await signedInToA(mathilde());
    await openFleets(page);
    accountApp.setDown(true);

    // When it chooses fleet B
    await page.getByRole('link', { name: 'second fleet' }).click();

    // Then the panel says so, focus on Try again, the console still in fleet A; Try again opens fleet B once the account app answers
    await page.getByText('Couldn’t open second fleet').waitFor();
    await page.getByText('You are still in home fleet. Try again to open second fleet.').waitFor();
    expect(await tokenFleetOf(page)).toBe(fleetA);
    accountApp.setDown(false);
    await page.getByRole('button', { name: 'Try again' }).click();
    await page.getByText('Console is open in second fleet.').waitFor({ timeout: 20_000 });
    expect(await tokenFleetOf(page)).toBe(fleetB);
  });

  it('links fleet B to Account when the account may not open the console there (H9)', async () => {
    const page = await signedInToA(mathilde({ scopes: ['messages:send'] }));

    await openFleets(page);

    await expect(page.getByTestId('app-switcher-fleet').filter({ hasText: 'second fleet' }).getAttribute('href')).resolves.toBe(ACCOUNT_URL);
  });

  it('says the account has no rights in fleet B once its rights there are gone', async () => {
    const page = await signedInToA(mathilde());
    accountApp.changeScopes({ accountId: 'acc-mathilde', fleetId: fleetB, scopes: [] });

    await page.goto(`/?fleet=${fleetB}`);

    await page.waitForURL(`${web.url}/sign-in/no-rights`);
    await page.getByText('You have no rights in this fleet. Ask an organisation admin.').waitFor();
  });

  it('is in fleet B as the account itself after switching there signed in as argo of fleet A', async () => {
    const page = await signedInToA(mathilde({ scopes: ['fleet:read'], isArgoAllowedInA: true }));
    await openSettings(page);
    await page.getByRole('button', { name: 'Sign in as argo' }).click();
    await page.getByTestId('argo-banner').getByText('You are signed in as argo').waitFor();

    await page.goto(`/?fleet=${fleetB}`);

    await isHydrated(page);
    await page.getByTestId('argo-banner').waitFor({ state: 'detached' });
    await expect(page.locator('[data-testid="app-switcher-fleet-pill"]:visible').getAttribute('title')).resolves.toContain('second fleet');
    await isSignedInAsAccount(page);
    expect(await tokenFleetOf(page)).toBe(fleetB);
    await expect(database.consoleSession.findMany({ where: { fleetId: fleetA, accountId: 'acc-mathilde' }, select: { endReason: true } })).resolves.toEqual([{ endReason: 'signedOut' }]);
  });

  it('signs in again and lands in fleet B when the shared sign-in ended before the switch', async () => {
    const page = await signedInToA(mathilde());
    accountApp.endSignIns();

    await page.goto(`/?fleet=${fleetB}`);

    await page.waitForURL(`${web.url}/?fleet=${fleetB}`);
    await isHydrated(page);
    await expect(page.locator('[data-testid="app-switcher-fleet-pill"]:visible').getAttribute('title')).resolves.toContain('second fleet');
    expect(await tokenFleetOf(page)).toBe(fleetB);
  });
});

describe("the Apps and fleets panel of an account's console (docs/design/app-navigation, section 4)", () => {
  it("says it couldn't load the apps and fleets while the account app does not answer, and Try again reads them", async () => {
    // Given the account app down as the console's page loads
    accountApp.signInAs(mathilde());
    const context = await browser.newContext({ baseURL: web.url });
    contexts.push(context);
    const page = await context.newPage();
    await page.goto(`/?fleet=${fleetA}`);
    await isHydrated(page);
    accountApp.setDown(true);
    await page.reload();
    await isHydrated(page);

    // When the panel opens
    await openFleets(page);

    // Then it says so, and once the account app answers again Try again reads them
    await page.getByText('Couldn’t load apps and fleets').waitFor();
    accountApp.setDown(false);
    await page.getByRole('button', { name: 'Try again' }).click();
    await page.getByText('Apps and fleets refreshed.').waitFor();
    await page.getByRole('link', { name: /second fleet/ }).waitFor();
  });

  it('says on the account button that the sign-in expired once the account app ended it', async () => {
    const page = await signedInToA(mathilde());
    accountApp.endSignIns();

    await page.reload();
    await isHydrated(page);

    await accountButton(page, 'Account: Sign-in expired').waitFor();
  });
});
