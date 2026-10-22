import type { FleetId, ShipId } from '@aeolus-fleet/common';
import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Page, Request } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../packages/core/src/adapters/prisma/client.js';
import { createApp } from '../packages/core/src/app.js';
import { createMigratedDatabase } from '../packages/core/src/testing/database.js';
import { secretOf } from '../packages/core/src/testing/fleet.js';
import { newKey } from '../packages/core/src/testing/keys.js';
import { unwrap } from '../packages/core/src/testing/result.js';
import { createUseCases, type UseCases } from '../packages/core/src/wiring.js';
import { FLEET_URL, OPERATOR, operatorCaller } from '../packages/core/test/support/core-fixtures.js';
import { startFakePagasae, type FakeAccount, type FakePagasae } from './support/fake-pagasae.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';

// A human signs in to the console as their own account (accounts design, F1,
// A8): through pagasae's shared sign-in, with an account token for the fleet,
// no lease, and the console showing what the account's scopes allow. pagasae
// is the fake one, answering as pagasae does.

let database: PrismaClient;
let pagasae: FakePagasae;
let server: FastifyInstance;
let web: RunningWeb;
let browser: Browser;
let fleetId: FleetId;
let lookoutId: ShipId;
let useCases: UseCases;
const contexts: BrowserContext[] = [];

function mathilde(scopes: readonly string[] = ['fleet:read', 'fleet:manage']): FakeAccount {
  return { id: 'acc-mathilde', email: 'mathilde@acme.example', fleets: [{ id: fleetId, name: 'home fleet', scopes }] };
}

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  useCases = createUseCases({ prisma: database });
  const fleet = unwrap(await useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR }));
  ({ fleetId } = fleet);
  unwrap(await useCases.commissionShip(operatorCaller(fleet), { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
  const lookout = unwrap(await useCases.commissionShip(operatorCaller(fleet), { idempotencyKey: newKey(), name: 'lookout', type: 'reviewer' }));
  lookoutId = lookout.shipId;
  unwrap(await useCases.claimShip({ shipId: lookoutId, secret: secretOf(lookout.secret), location: { kind: 'CLOUD' }, harness: 'claude-code' }));

  pagasae = await startFakePagasae();
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

async function newPage(): Promise<Page> {
  const context = await browser.newContext({ baseURL: web.url });
  contexts.push(context);
  return context.newPage();
}

describe('an account signing in to the console', () => {
  it('signs in through pagasae once and sees the fleet as itself, with no Compose and no lease taken', async () => {
    pagasae.signInAs(mathilde());
    const leasesBefore = await database.lease.count({ where: { fleetId } });
    const page = await newPage();

    await page.goto('/');

    await page.waitForURL(`${web.url}/`);
    await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
    await page.getByRole('link', { name: 'scout' }).first().waitFor();
    await page.locator('[data-testid="avatar-menu"]:visible').click();
    await page.getByTestId('avatar-menu-signed-in-as').getByText('Signed in as your account').waitFor();
    await page.getByRole('menu').getByText('mathilde@acme.example').first().waitFor();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('header-compose').count()).resolves.toBe(0);
    await expect(database.lease.count({ where: { fleetId } })).resolves.toBe(leasesBefore);
    await expect(database.consoleSession.count({ where: { fleetId } })).resolves.toBe(0);
  });

  it('enters at once with the shared sign-in already there: no second sign-in at pagasae', async () => {
    pagasae.signInAs(mathilde());
    const page = await newPage();
    await page.goto('/');
    await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
    const asked = pagasae.signInsAsked();
    const context = page.context();
    // The console's own sign-in cookies go; pagasae's shared sign-in stays.
    await context.clearCookies({ name: 'aeolus_account_token' });

    await page.goto('/ships');

    await page.waitForURL(`${web.url}/ships`);
    expect(pagasae.signInsAsked()).toBe(asked);
  });

  it("asks pagasae for the account's apps list once per page load: the header and the avatar menu share it", async () => {
    pagasae.signInAs(mathilde());
    const page = await newPage();
    await page.goto('/');
    await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
    await page.waitForLoadState('networkidle');
    const asked = pagasae.appsListsAsked();

    await page.reload();
    await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
    await page.waitForLoadState('networkidle');

    expect(pagasae.appsListsAsked() - asked).toBe(1);
  });

  it("asks pagasae for the apps list no more when the account comes back to the page's tab", async () => {
    pagasae.signInAs(mathilde());
    const page = await newPage();
    await page.goto('/');
    await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
    await page.waitForLoadState('networkidle');
    const asked = pagasae.appsListsAsked();
    const reads: Request[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/reads/')) {
        reads.push(request);
      }
    });
    // The fleet list is read again when the tab comes back: that round is what the test waits for.
    const listedAgain = page.waitForResponse((response) => response.url().includes('fleet.list'));

    // The page's tab goes to the background and comes back, as switching tabs does.
    await page.evaluate("for (const state of ['hidden', 'visible']) { Object.defineProperty(document, 'visibilityState', { value: state, configurable: true }); window.dispatchEvent(new Event('visibilitychange')); }");
    await listedAgain;
    await Promise.all(reads.map((read) => read.response()));

    expect(pagasae.appsListsAsked()).toBe(asked);
  });

  it("pings a crewed ship from its page: argo's ping, the event naming the account", async () => {
    pagasae.signInAs(mathilde());
    const page = await newPage();

    await page.goto(`/ships/${lookoutId}`);
    await page.getByTestId('fleet-ship-ping').click();

    await page.getByTestId('ship-ping-status').getByText('Pinged just now, no answer yet').waitFor();
    const event = await database.event.findFirstOrThrow({ where: { fleetId, type: 'MessageAccepted', shipId: lookoutId }, select: { actorKind: true, actorAccountId: true } });
    expect(event).toEqual({ actorKind: 'account', actorAccountId: 'acc-mathilde' });
  });

  it('shows the notices for accounts above every page, and keeps one it dismissed gone (accounts design, A9)', async () => {
    await useCases.setNotices({ notices: [{ id: 'teams', audience: 'accounts', text: 'Your organisation now signs in with its own accounts.', links: [], isDismissible: true }] });
    pagasae.signInAs(mathilde());
    const page = await newPage();
    await page.goto('/');

    await page.getByTestId('notice').getByText('Your organisation now signs in with its own accounts.').waitFor();
    await page.getByTestId('notice-dismiss').click();
    await page.getByTestId('notice').waitFor({ state: 'detached' });
    await page.reload();
    await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();

    await expect(page.getByTestId('notice').count()).resolves.toBe(0);
    await useCases.setNotices({ notices: [] });
  });

  it('keeps the theme the account picks in the browser, from the first paint of the next page (header design, C5)', async () => {
    pagasae.signInAs(mathilde());
    const page = await newPage();
    await page.goto('/');
    await page.locator('[data-testid="avatar-menu"]:visible').click();

    await page.getByTestId('avatar-menu-theme-dark').click();
    await page.reload();

    await expect(page.locator('html').getAttribute('class')).resolves.toContain('dark');
  });

  it('says there is nothing to manage here for an account without fleet:read', async () => {
    pagasae.signInAs(mathilde(['messages:send']));
    const page = await newPage();

    await page.goto('/');

    await page.waitForURL(`${web.url}/sign-in/nothing-to-manage`);
    await page.getByText('Nothing to manage here').waitFor();
  });

  it('says the account has no rights in the fleet when it holds none', async () => {
    pagasae.signInAs({ id: 'acc-burak', email: 'burak@acme.example', fleets: [] });
    const page = await newPage();

    await page.goto('/');

    await page.waitForURL(`${web.url}/sign-in/no-rights`);
    await page.getByText('You have no rights in this fleet. Ask an organisation admin.').waitFor();
  });

  it("says a sign-in that did not go through in an account's words, never argo's terminal link", async () => {
    pagasae.signInAs(mathilde());
    const page = await newPage();

    await page.goto('/sign-in/done?code=forged&state=forged');

    await page.waitForURL(`${web.url}/sign-in/failed`);
    await page.getByText('Your sign-in didn’t go through. Sign in again.').waitFor();
    await expect(page.getByText('npx aeolus-core sign-in').count()).resolves.toBe(0);
    await page.getByTestId('sign-in-failed-again').click();
    await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
  });

  it('signs out of every app: the shared sign-in ends at pagasae and the console asks to sign in again', async () => {
    pagasae.signInAs(mathilde());
    const page = await newPage();
    await page.goto('/');
    await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
    const revokedBefore = pagasae.revoked().length;

    await page.locator('[data-testid="avatar-menu"]:visible').click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();

    await page.waitForURL(`${web.url}/sign-in?signed=out`);
    await page.getByTestId('sign-in-signed-out').waitFor();
    expect(pagasae.revoked().length).toBe(revokedBefore + 1);
    const cookies = await page.context().cookies();
    expect(cookies.map(({ name }) => name)).not.toContain('aeolus_account_token');
  });
});
