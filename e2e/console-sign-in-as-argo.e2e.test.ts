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
import { FLEET_URL, OPERATOR, operatorCaller } from '../packages/core/test/support/core-fixtures.js';
import { startFakePagasae, type FakeAccount, type FakePagasae } from './support/fake-pagasae.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';

// Break-glass (accounts design, F4, A7): an account allowed as argo signs in
// as argo from the console, warned when someone else holds argo, sees the
// argo banner, and Sign out of argo returns it to its account. The tests run
// in order, as the two accounts take argo from each other.

let database: PrismaClient;
let pagasae: FakePagasae;
let server: FastifyInstance;
let web: RunningWeb;
let browser: Browser;
let fleetId: FleetId;
let mathildePage: Page;
let thomasPage: Page;
const contexts: BrowserContext[] = [];

function account(name: string, fleet: { isArgoAllowed: boolean }): FakeAccount {
  return { id: `acc-${name}`, email: `${name}@acme.example`, fleets: [{ id: fleetId, name: 'home fleet', scopes: ['fleet:read', 'fleet:manage'], ...fleet }] };
}

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  const useCases = createUseCases({ prisma: database });
  const fleet = unwrap(await useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR }));
  ({ fleetId } = fleet);
  unwrap(await useCases.commissionShip(operatorCaller(fleet), { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));

  // pagasae asks core for the ticket with the installation token; here the test's core issues it.
  pagasae = await startFakePagasae({
    argoTickets: async (forFleet, accountId) => unwrap(await useCases.issueSignInTicket({ fleetId: idSchema('fleet').parse(forFleet), account: { id: accountIdSchema.parse(accountId) } })).ticket,
  });
  const webUrl = await reserveWebUrl();
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

/** A new browser signed in to the console as the account. */
async function signedInAs(who: FakeAccount): Promise<Page> {
  pagasae.signInAs(who);
  const context = await browser.newContext({ baseURL: web.url });
  contexts.push(context);
  const page = await context.newPage();
  await page.goto('/');
  await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
  return page;
}

async function openAccountMenu(page: Page): Promise<void> {
  await page.locator('[data-testid="avatar-menu"]:visible').click();
}

/** The avatar menu says the page is signed in as the account itself, not as argo. */
async function isSignedInAsAccount(page: Page): Promise<void> {
  await openAccountMenu(page);
  await page.getByTestId('avatar-menu-signed-in-as').getByText('Signed in as your account').waitFor();
  await page.keyboard.press('Escape');
}

async function argoSessionsOf(accountId: string) {
  return database.consoleSession.findMany({ where: { fleetId, accountId }, select: { endedAt: true, endReason: true } });
}

describe('signing in as argo from the console', () => {
  it('offers an account not allowed as argo no Sign in as argo, and refuses one it forges', async () => {
    const page = await signedInAs(account('burak', { isArgoAllowed: false }));
    await openAccountMenu(page);
    await page.getByRole('menuitem', { name: 'Sign out' }).waitFor();
    await expect(page.getByRole('menuitem', { name: 'Sign in as argo' }).count()).resolves.toBe(0);
    await page.keyboard.press('Escape');

    // The POST the menu would make, from the console's own page.
    await page.evaluate("const form = document.createElement('form'); form.method = 'post'; form.action = '/sign-in/argo'; document.body.append(form); form.submit();");

    await page.getByText('Your account may not sign in as argo of this fleet.').waitFor();
    await expect(argoSessionsOf('acc-burak')).resolves.toEqual([]);
  });

  it('signs an allowed account in as argo with one press while no one holds argo: the banner, and Compose', async () => {
    mathildePage = await signedInAs(account('mathilde', { isArgoAllowed: true }));
    await openAccountMenu(mathildePage);

    await mathildePage.getByRole('menuitem', { name: 'Sign in as argo' }).click();

    await mathildePage.getByTestId('argo-banner').getByText('You are signed in as argo').waitFor();
    await mathildePage.getByTestId('header-compose').first().waitFor();
    await expect(argoSessionsOf('acc-mathilde')).resolves.toEqual([{ endedAt: null, endReason: null }]);
  });

  it('warns before taking argo from another account, and Cancel leaves both as they were', async () => {
    thomasPage = await signedInAs(account('thomas', { isArgoAllowed: true }));
    await openAccountMenu(thomasPage);

    await thomasPage.getByRole('menuitem', { name: 'Sign in as argo' }).click();

    await thomasPage.getByText('This signs mathilde@acme.example out of argo.').waitFor();
    await thomasPage.getByTestId('sign-in-argo-cancel').click();
    await isSignedInAsAccount(thomasPage);
    await expect(argoSessionsOf('acc-mathilde')).resolves.toEqual([{ endedAt: null, endReason: null }]);
  });

  it('takes argo over on Continue: the other account is signed out of argo', async () => {
    await openAccountMenu(thomasPage);
    await thomasPage.getByRole('menuitem', { name: 'Sign in as argo' }).click();

    await thomasPage.getByTestId('sign-in-argo-continue').click();

    await thomasPage.getByTestId('argo-banner').getByText('You are signed in as argo').waitFor();
    await expect(argoSessionsOf('acc-mathilde')).resolves.toEqual([expect.objectContaining({ endReason: 'takenOver' })]);
    await expect(argoSessionsOf('acc-thomas')).resolves.toEqual([{ endedAt: null, endReason: null }]);
  });

  it('tells the account taken off argo why, and Sign in with your account brings it into its own console', async () => {
    await mathildePage.goto('/');

    await mathildePage.getByTestId('sign-in-signed-in-elsewhere').getByText('Your argo sign-in ended because someone signed in as argo elsewhere.').waitFor();
    pagasae.signInAs(account('mathilde', { isArgoAllowed: true }));
    await mathildePage.getByTestId('sign-in-account-start').click();

    await mathildePage.getByRole('heading', { name: 'Fleet overview' }).waitFor();
    await isSignedInAsAccount(mathildePage);
  });

  it('signs out of argo back to the account, with no sign-in step', async () => {
    const signInsBefore = pagasae.signInsAsked();

    await thomasPage.getByTestId('argo-banner').getByRole('button', { name: 'Sign out of argo' }).click();

    await thomasPage.getByTestId('argo-banner').waitFor({ state: 'detached' });
    await isSignedInAsAccount(thomasPage);
    expect(pagasae.signInsAsked()).toBe(signInsBefore);
    await expect(argoSessionsOf('acc-thomas')).resolves.toEqual([expect.objectContaining({ endReason: 'signedOut' })]);
  });

  it('offers Sign in as argo on the sign-in page to an allowed account, warning of no one while argo is free, though its token cookie ended', async () => {
    await mathildePage.context().clearCookies({ name: 'aeolus_account_token' });
    await mathildePage.goto('/sign-in');

    await mathildePage.getByTestId('sign-in-argo-start').click();

    await mathildePage.getByTestId('argo-banner').getByText('You are signed in as argo').waitFor();
    expect(new URL(mathildePage.url()).pathname).toBe('/');
    await expect(argoSessionsOf('acc-mathilde')).resolves.toContainEqual({ endedAt: null, endReason: null });
  });
});
