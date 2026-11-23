import type { FleetId, ShipId } from '@aeolus-fleet/common';
import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Page, Request } from 'playwright';
import { THEME_COOKIE } from '@aeolus-fleet/common/rules';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../packages/core/src/adapters/prisma/client.js';
import { createApp } from '../packages/core/src/app.js';
import { createMigratedDatabase } from '../packages/core/src/testing/database.js';
import { secretOf } from '../packages/core/src/testing/fleet.js';
import { newKey } from '../packages/core/src/testing/keys.js';
import { unwrap } from '../packages/core/src/testing/result.js';
import { createUseCases, type UseCases } from '../packages/core/src/wiring.js';
import { FLEET_URL, OPERATOR, operatorCaller } from '../packages/core/test/support/core-fixtures.js';
import { sharedSignInOf, startFakeAccountApp, type FakeAccount, type FakeAccountApp } from './support/fake-account-app.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';
import { afterFrames, pageClasses, visible } from './support/browser.js';
import { formPostHeld, holdFormPosts, letFormPostsGo, openSettings } from './support/console.js';

// A human signs in to the console as their own account (accounts design, F1,
// A8): through the account app's shared sign-in, with an account token for the fleet,
// no lease, and the console showing what the account's scopes allow. the account app
// is the fake one, answering as the account app does.

let database: PrismaClient;
let accountApp: FakeAccountApp;
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

  accountApp = await startFakeAccountApp();
  const webUrl = await reserveWebUrl();
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

async function newPage(): Promise<Page> {
  const context = await browser.newContext({ baseURL: web.url });
  contexts.push(context);
  return context.newPage();
}

describe('an account signing in to the console', () => {
  it('signs in through the account app once and sees the fleet as itself, with no Compose and no lease taken', async () => {
    accountApp.signInAs(mathilde());
    const leasesBefore = await database.lease.count({ where: { fleetId } });
    const page = await newPage();

    await page.goto('/');

    await page.waitForURL(`${web.url}/`);
    await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
    await page.getByRole('link', { name: 'scout' }).first().waitFor();
    // Live shows once the page is hydrated: a menu click before that does nothing.
    await page.getByRole('banner').getByText('Live', { exact: true }).waitFor({ timeout: 20_000 });
    await visible(page, 'avatar-menu').click();
    await page.getByText('Signed in with your account').filter({ visible: true }).waitFor();
    await page.getByTestId('avatar-menu-who').getByText('Your account', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('header-compose').count()).resolves.toBe(0);
    await expect(database.lease.count({ where: { fleetId } })).resolves.toBe(leasesBefore);
    await expect(database.consoleSession.count({ where: { fleetId } })).resolves.toBe(0);
  });

  it('enters at once with the shared sign-in already there: no second sign-in at the account app', async () => {
    accountApp.signInAs(mathilde());
    const page = await newPage();
    await page.goto('/');
    await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
    const asked = accountApp.signInsAsked();
    const context = page.context();
    // The console's own sign-in cookies go; the account app's shared sign-in stays.
    await context.clearCookies({ name: 'aeolus_account_token' });

    await page.goto('/ships');

    await page.waitForURL(`${web.url}/ships`);
    expect(accountApp.signInsAsked()).toBe(asked);
  });

  it("asks the account app for the account's apps list once per page load: the header and the avatar menu share it", async () => {
    accountApp.signInAs(mathilde());
    const page = await newPage();
    const firstList = page.waitForResponse((response) => response.url().includes('/api/reads/apps-list'));
    const firstPalette = page.waitForResponse((response) => response.url().includes('/api/reads/palette-across-apps'));
    await page.goto('/');
    await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
    await page.getByText('Live', { exact: true }).filter({ visible: true }).first().waitFor();
    await Promise.all([firstList, firstPalette]);
    const signIn = sharedSignInOf(await page.context().cookies());
    if (signIn === undefined) throw new Error('The account has no shared sign-in');
    await afterFrames(page);
    // Sign-in also reads the list to choose the fleet, before the page reads it.
    expect(accountApp.appsListsAsked(signIn)).toBe(2);

    const reloadedList = page.waitForResponse((response) => response.url().includes('/api/reads/apps-list'));
    const reloadedPalette = page.waitForResponse((response) => response.url().includes('/api/reads/palette-across-apps'));
    await page.reload();
    await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
    // Live: the page has connected, and the reads it makes once connected are made.
    await page.getByText('Live', { exact: true }).filter({ visible: true }).first().waitFor();
    await Promise.all([reloadedList, reloadedPalette]);
    await afterFrames(page);

    expect(accountApp.appsListsAsked(signIn)).toBe(3);
  });

  it("asks the account app for the apps list no more when the account comes back to the page's tab", async () => {
    accountApp.signInAs(mathilde());
    const page = await newPage();
    await page.goto('/');
    await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
    await page.getByText('Live', { exact: true }).filter({ visible: true }).first().waitFor();
    const asked = accountApp.appsListsAsked();
    const reads: Request[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/reads/')) {
        reads.push(request);
      }
    });
    // Harbour is read again when the tab comes back: that round is what the test waits for.
    const listedAgain = page.waitForResponse((response) => response.url().includes('fleet.harbour'));

    // The page's tab goes to the background and comes back, as switching tabs does.
    await page.evaluate("for (const state of ['hidden', 'visible']) { Object.defineProperty(document, 'visibilityState', { value: state, configurable: true }); window.dispatchEvent(new Event('visibilitychange')); }");
    await listedAgain;
    await Promise.all(reads.map((read) => read.response()));

    expect(accountApp.appsListsAsked()).toBe(asked);
  });

  it("pings a crewed ship from its page: argo's ping, the event naming the account", async () => {
    accountApp.signInAs(mathilde());
    const page = await newPage();

    await page.goto(`/ships/${lookoutId}`);
    await page.getByTestId('fleet-ship-ping').click();

    await page.getByTestId('ship-ping-status').getByText('Pinged just now, no answer yet').waitFor();
    const event = await database.event.findFirstOrThrow({ where: { fleetId, type: 'MessageAccepted', shipId: lookoutId }, select: { actorKind: true, actorAccountId: true } });
    expect(event).toEqual({ actorKind: 'account', actorAccountId: 'acc-mathilde' });
  });

  it('shows the notices for accounts above every page, and keeps one it dismissed gone (accounts design, A9)', async () => {
    await useCases.setNotices({ notices: [{ id: 'teams', audience: 'accounts', text: 'Your organisation now signs in with its own accounts.', links: [], isDismissible: true }] });
    accountApp.signInAs(mathilde());
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

  it('keeps the theme the account picks in the cookie every Aeolus app reads, from the first paint of the next page (header-across-apps T1)', async () => {
    // Given an account signed in to the console
    accountApp.signInAs(mathilde());
    const page = await newPage();
    await page.goto('/');
    await openSettings(page);

    // When it picks Dark
    await page.getByRole('button', { name: 'Dark' }).click();

    // Then the browser keeps Dark for every app, and the next page paints it
    await expect.poll(async () => (await page.context().cookies()).find((cookie) => cookie.name === THEME_COOKIE)?.value).toBe('dark');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect.poll(() => pageClasses(page)).toContain('dark');
  });

  it('shows the theme another Aeolus app kept in this browser, from the first paint (header-across-apps T1)', async () => {
    // Given a browser where Bridge kept Dark
    accountApp.signInAs(mathilde());
    const page = await newPage();
    await page.context().addCookies([{ name: THEME_COOKIE, value: 'dark', url: web.url }]);

    // When the account opens the console
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Then the console is dark from the first paint
    expect(await pageClasses(page)).toContain('dark');
  });

  it('says there is nothing to manage here for an account without fleet:read', async () => {
    accountApp.signInAs(mathilde(['messages:send']));
    const page = await newPage();

    await page.goto('/');

    await page.waitForURL(`${web.url}/sign-in/nothing-to-manage`);
    await page.getByText('Nothing to manage here').waitFor();
  });

  it('says the account has no rights in the fleet when it holds none', async () => {
    accountApp.signInAs({ id: 'acc-burak', email: 'burak@acme.example', fleets: [] });
    const page = await newPage();

    await page.goto('/');

    await page.waitForURL(`${web.url}/sign-in/no-rights`);
    await page.getByText('You have no rights in this fleet. Ask an organisation admin.').waitFor();
  });

  it("says a sign-in that did not go through in an account's words, never argo's terminal link", async () => {
    accountApp.signInAs(mathilde());
    const page = await newPage();

    await page.goto('/sign-in/done?code=forged&state=forged');

    await page.waitForURL(`${web.url}/sign-in/failed`);
    await page.getByText('Your sign-in didn’t go through. Sign in again.').waitFor();
    await expect(page.getByText('npx aeolus-core sign-in').count()).resolves.toBe(0);
    await page.getByTestId('sign-in-failed-again').click();
    await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
  });

  it('signs out of every app: the shared sign-in ends at the account app and the console asks to sign in again', async () => {
    accountApp.signInAs(mathilde());
    const page = await newPage();
    await page.goto('/');
    await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
    const revokedBefore = accountApp.revoked().length;

    await visible(page, 'avatar-menu').click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();

    await page.waitForURL(`${web.url}/sign-in?signed=out`);
    await page.getByTestId('sign-in-signed-out').waitFor();
    expect(accountApp.revoked().length).toBe(revokedBefore + 1);
    const cookies = await page.context().cookies();
    expect(cookies.map(({ name }) => name)).not.toContain('aeolus_account_token');
  });

  it('shows Sign out busy and says "Signing out…" while the account signs out of every app (docs/design/app-navigation, feedback)', async () => {
    // Given an account signed in, whose way out the browser holds before it leaves the page
    accountApp.signInAs(mathilde());
    const page = await newPage();
    await page.goto('/');
    await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
    await page.getByText('Live', { exact: true }).filter({ visible: true }).first().waitFor({ timeout: 20_000 });
    // A page that has started leaving cannot be read, so the form's post waits here until the test lets it go.
    await holdFormPosts(page);

    // When the account presses Sign out
    await visible(page, 'avatar-menu').click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await formPostHeld(page, '/sign-in/out');

    // Then the row waits with its busy icon and the panel says it is signing out, until the way out answers
    await page.getByRole('status').getByText('Signing out…').waitFor();
    await expect(page.getByRole('menuitem', { name: 'Sign out' }).getAttribute('aria-disabled')).resolves.toBe('true');
    await letFormPostsGo(page);
    await page.waitForURL(`${web.url}/sign-in?signed=out`);
  });
});
