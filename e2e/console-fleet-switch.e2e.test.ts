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
import { FAKE_CONSOLE_URL, startFakePagasae, type FakeAccount, type FakePagasae } from './support/fake-pagasae.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';

// An account switches the console between two fleets of one organisation
// with the one sign-in it has (second fleet design; header design, H9): the
// console asks pagasae for the other fleet's account token, never a new
// sign-in, and renews for the fleet in view from then on.

const ACCOUNT_URL = 'https://account.acme.example/account';

let database: PrismaClient;
let pagasae: FakePagasae;
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
  // Two fleets the installation creates, as pagasae creates an organisation's fleets.
  ({ fleetId: fleetA } = unwrap(await useCases.createFleet({ requestId: newKey(), name: 'home fleet', operatorEmail: 'admin@acme.example' })));
  ({ fleetId: fleetB } = unwrap(await useCases.createFleet({ requestId: newKey(), name: 'second fleet', operatorEmail: 'admin-second@acme.example' })));

  const webUrl = await reserveWebUrl();
  pagasae = await startFakePagasae({
    accountUrl: ACCOUNT_URL,
    argoTickets: async (forFleet, accountId) => unwrap(await useCases.issueSignInTicket({ fleetId: idSchema('fleet').parse(forFleet), account: { id: accountIdSchema.parse(accountId) } })).ticket,
  });
  server = createApp({ databaseUrl, publicUrl: FLEET_URL, consoleOrigin: webUrl, logger: false, accountTokenIssuer: pagasae.url });
  const serverUrl = await server.listen({ host: '127.0.0.1', port: 0 });
  web = await startWeb({ url: webUrl, serverUrl, pagasae });
  browser = await launchChromium();
});

afterAll(async () => {
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
  await web.stop();
  await server.close();
  await pagasae.close();
  await database.$disconnect();
});

/** A new browser signed in to the console in fleet A as the account, the page hydrated. */
async function signedInToA(who: FakeAccount): Promise<Page> {
  pagasae.signInAs(who);
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

/** The header's fleet menu, opened. */
async function openFleets(page: Page): Promise<void> {
  await page.locator('[data-testid="app-switcher-fleets"]:visible').click();
}

/** The avatar menu says the page is signed in as the account itself, not as argo. */
async function isSignedInAsAccount(page: Page): Promise<void> {
  const trigger = page.locator('[data-testid="avatar-menu"][aria-label*="Signed in as"]:visible');
  await trigger.click();
  await page.getByTestId('avatar-menu-signed-in-as').getByText('Signed in as your account').waitFor();
  await page.keyboard.press('Escape');
}

describe('switching the console between two fleets of one organisation', () => {
  it("lands in the console in fleet B from the header's switcher, with the same sign-in, and renews for fleet B", async () => {
    const page = await signedInToA(mathilde());
    const signInsBefore = pagasae.signInsAsked();

    await openFleets(page);
    const link = new URL((await page.getByTestId('app-switcher-fleet').filter({ hasText: 'second fleet' }).getAttribute('href')) ?? '');
    expect(link.origin).toBe(FAKE_CONSOLE_URL);
    expect(link.searchParams.get('fleet')).toBe(fleetB);
    // The apps list names the hosted console's address: the same path and query on this console.
    await page.goto(`${link.pathname}${link.search}`);

    await page.waitForURL(`${web.url}/?fleet=${fleetB}`);
    await isHydrated(page);
    await expect(page.locator('[data-testid="app-switcher-fleets"]:visible').getAttribute('aria-label')).resolves.toContain('second fleet');
    expect(pagasae.signInsAsked()).toBe(signInsBefore);
    expect(await tokenFleetOf(page)).toBe(fleetB);
    const renewal = await page.request.post('/sign-in/renew', { headers: { origin: web.url } });
    expect(renewal.status()).toBe(200);
    expect(await tokenFleetOf(page)).toBe(fleetB);
  });

  it('links fleet B to Account when the account may not open the console there (H9)', async () => {
    const page = await signedInToA(mathilde({ scopes: ['messages:send'] }));

    await openFleets(page);

    await expect(page.getByTestId('app-switcher-fleet').filter({ hasText: 'second fleet' }).getAttribute('href')).resolves.toBe(ACCOUNT_URL);
  });

  it('says the account has no rights in fleet B once its rights there are gone', async () => {
    const page = await signedInToA(mathilde());
    pagasae.changeScopes({ accountId: 'acc-mathilde', fleetId: fleetB, scopes: [] });

    await page.goto(`/?fleet=${fleetB}`);

    await page.waitForURL(`${web.url}/sign-in/no-rights`);
    await page.getByText('You have no rights in this fleet. Ask an organisation admin.').waitFor();
  });

  it('is in fleet B as the account itself after switching there signed in as argo of fleet A', async () => {
    const page = await signedInToA(mathilde({ scopes: ['fleet:read'], isArgoAllowedInA: true }));
    await page.locator('[data-testid="avatar-menu"][aria-label*="Signed in as"]:visible').click();
    await page.getByRole('menuitem', { name: 'Sign in as argo' }).click();
    await page.getByTestId('argo-banner').getByText('You are signed in as argo').waitFor();

    await page.goto(`/?fleet=${fleetB}`);

    await isHydrated(page);
    await page.getByTestId('argo-banner').waitFor({ state: 'detached' });
    await expect(page.locator('[data-testid="app-switcher-fleets"]:visible').getAttribute('aria-label')).resolves.toContain('second fleet');
    await isSignedInAsAccount(page);
    expect(await tokenFleetOf(page)).toBe(fleetB);
    await expect(database.consoleSession.findMany({ where: { fleetId: fleetA, accountId: 'acc-mathilde' }, select: { endReason: true } })).resolves.toEqual([{ endReason: 'signedOut' }]);
  });
});
