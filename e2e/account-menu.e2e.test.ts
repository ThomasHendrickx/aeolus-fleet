import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Page } from 'playwright';
import { THEME_COOKIE } from '@aeolus-fleet/common/rules';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../packages/core/src/adapters/prisma/client.js';
import { createApp } from '../packages/core/src/app.js';
import { createUseCases, type UseCases } from '../packages/core/src/wiring.js';
import { FLEET_URL, OPERATOR } from '../packages/core/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../packages/core/src/testing/database.js';
import { createTestClock } from '../packages/core/test/support/postgres-core.js';
import { unwrap } from '../packages/core/src/testing/result.js';
import { accountButton, holdSignOutSlow, openSettings, signIn } from './support/console.js';
import { afterFrames, isInState, pageClasses, visible } from './support/browser.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';
import { withOperatorLogin } from '../packages/core/test/support/operator-login.js';


// The account panel and Settings, end to end, on desktop and on phone: who is
// signed in, the session's device and Sign out in the panel; argo's theme in
// Settings, which applies at once and comes back from this browser's theme
// cookie on the next load (docs/design/app-navigation).

const clock = createTestClock('2026-10-01T09:00:00.000Z');
/** Sign-ins are rate limited per window; each test signs in after the window of the one before. */
const SIGN_IN_WINDOW_MS = 60_000;

let database: PrismaClient;
let useCases: UseCases;
let server: FastifyInstance;
let web: RunningWeb;
let browser: Browser;
const contexts: BrowserContext[] = [];

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  useCases = createUseCases({ prisma: database, clock });
  unwrap(await withOperatorLogin(database, useCases.initialiseFleet({ name: 'home fleet' })));

  const webUrl = await reserveWebUrl();
  server = createApp({
    databaseUrl,
    publicUrl: FLEET_URL,
    consoleOrigin: webUrl,
    clock,
    logger: false,
  });
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

/** A phone: below the sm breakpoint, where the TopBar Avatar opens the menu as a bottom sheet. */
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

async function signedInPage(options: { isPhone: boolean; beforeSignIn?: (page: Page) => Promise<void> }): Promise<Page> {
  clock.advance(SIGN_IN_WINDOW_MS);
  const context = await browser.newContext({ baseURL: web.url, ...(options.isPhone ? PHONE : {}) });
  contexts.push(context);
  const page = await context.newPage();
  await options.beforeSignIn?.(page);
  await signIn(page, OPERATOR);
  await page.waitForURL(`${web.url}/`);
  return page;
}

/**
 * Holds the server's answer to the first call that asks the given procedure
 * for a while on its way back to the console: the server has answered,
 * renewing the session cookie, but the console has not heard it yet.
 */
async function holdOneAnswer(page: Page, procedure: string): Promise<{ reached: Promise<undefined>; answered: Promise<undefined>; release: () => void }> {
  const reached = Promise.withResolvers<undefined>();
  const answered = Promise.withResolvers<undefined>();
  const released = Promise.withResolvers<undefined>();
  let isHolding = false;
  await page.route(
    (url) => (url.pathname.startsWith('/trpc/') || url.pathname.startsWith('/api/reports/')) && url.pathname.includes(procedure),
    async (route) => {
      if (isHolding) {
        await route.continue();
        return;
      }
      isHolding = true;
      const response = await route.fetch();
      reached.resolve(undefined);
      await released.promise;
      await route.fulfill({ response });
      answered.resolve(undefined);
    },
  );
  const release = (): void => {
    released.resolve(undefined);
  };
  return { reached: reached.promise, answered: answered.promise, release };
}

/** What the console logs about a component switching between controlled and uncontrolled, as React and Base UI warn. */
function controlledWarnings(page: Page): string[] {
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (/uncontrolled/i.test(message.text())) {
      warnings.push(message.text());
    }
  });
  return warnings;
}

async function isDark(page: Page): Promise<boolean> {
  return (await pageClasses(page)).includes('dark');
}

describe.each([
  ['desktop', false],
  ['phone', true],
])('the account panel and Settings on %s', (_device, isPhone) => {
  it('holds who is signed in, this session and Sign out only, in the account panel at the end of the bar (docs/design/app-navigation)', async () => {
    // Given argo signed in
    const page = await signedInPage({ isPhone });

    // When argo opens the account panel
    await accountButton(page, 'Account: Signed in as argo').click();

    // Then it names argo and this session, and offers Sign out alone
    await page.getByText(/^This session: Device · .*Chrome, since/).filter({ visible: true }).waitFor();
    const panel = (isPhone ? page.getByRole('dialog', { name: 'Account' }) : page.getByRole('menu')).filter({ visible: true });
    await panel.getByText('Signed in as argo, for Console in home fleet').waitFor();
    await expect(panel.getByRole(isPhone ? 'button' : 'menuitem').allTextContents()).resolves.toEqual(isPhone ? ['Sign out', 'Cancel'] : ['Sign out']);
  });

  it('offers Settings last in the navigation, the tab bar\'s last tab on phone (docs/design/app-navigation)', async () => {
    const page = await signedInPage({ isPhone });

    const navigation = page.getByRole('navigation', { name: 'Console' }).filter({ visible: true });

    await expect(navigation.getByRole('link').last().textContent()).resolves.toBe('Settings');
  });

  it('argo follows this browser: a theme picked in Settings shows at once, is kept in the theme cookie every app reads, and comes back on the next load (header-across-apps T2)', async () => {
    // Given argo signed in, on Settings
    const page = await signedInPage({ isPhone });
    await openSettings(page);

    // When argo picks Dark
    await page.getByRole('button', { name: 'Dark' }).click();

    // Then it shows at once, focus stays on it, the browser keeps it, and the next load paints it
    await expect.poll(() => isDark(page)).toBe(true);
    await page.getByRole('status').filter({ hasText: 'Theme: Dark' }).waitFor();
    await expect.poll(() => isInState(page.getByRole('button', { name: 'Dark' }), ':focus')).toBe(true);
    await expect.poll(() => themeCookieOf(page)).toBe('dark');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(isDark(page)).resolves.toBe(true);

    await hydrated(page);
    await page.getByRole('button', { name: 'Light' }).click();
    await expect.poll(() => isDark(page)).toBe(false);
    await expect.poll(() => themeCookieOf(page)).toBe('light');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(isDark(page)).resolves.toBe(false);
  });

  it('shows argo the theme this browser keeps from the first paint, as another app kept it (header-across-apps T1, T2)', async () => {
    // Given argo signed in, in a browser where another app kept Dark
    const page = await signedInPage({ isPhone });
    await page.context().addCookies([{ name: THEME_COOKIE, value: 'dark', url: web.url }]);

    // When the next page loads
    await page.reload({ waitUntil: 'domcontentloaded' });

    // Then it is dark from the first paint, and Settings says Dark
    await expect(isDark(page)).resolves.toBe(true);
    await openSettings(page);
    await expect.poll(() => page.getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('links to the source on GitHub as Help in Settings, opening in a new tab', async () => {
    const page = await signedInPage({ isPhone });
    await openSettings(page);
    const source = page.getByRole('link', { name: /^Help/ });

    await expect(source.getAttribute('href')).resolves.toBe('https://github.com/ThomasHendrickx/aeolus-fleet');
    await expect(source.getAttribute('target')).resolves.toBe('_blank');
  });

  it('opens Keyboard shortcuts from Settings on desktop only, and Escape returns to its row (H6)', async () => {
    const page = await signedInPage({ isPhone });
    await openSettings(page);
    await page.getByRole('heading', { name: 'Help' }).waitFor();
    const shortcuts = page.getByRole('button', { name: 'Keyboard shortcuts' });
    if (isPhone) {
      await expect(shortcuts.count()).resolves.toBe(0);
      return;
    }

    await shortcuts.click();
    await page.getByRole('dialog', { name: 'Keyboard shortcuts' }).getByText('Search ships or jump to').waitFor();
    await page.keyboard.press('Escape');

    await expect.poll(() => isInState(shortcuts, ':focus')).toBe(true);
  });

  it('explains in the Apps and fleets panel that this installation has Console alone (docs/design/app-navigation, single-app)', async () => {
    const page = await signedInPage({ isPhone });
    await hydrated(page);

    await page.getByRole('button', { name: 'Apps and fleets' }).filter({ visible: true }).click();

    await page.getByText('Only Console is configured in this installation. There are no other apps to open.').waitFor();
    await page.getByText('This is the only fleet you can open.').waitFor();
  });

  it('offers no Your account on a self-hosted console', async () => {
    const page = await signedInPage({ isPhone });

    await openSettings(page);

    await page.getByRole('heading', { name: 'Help' }).waitFor();
    await expect(page.getByRole('heading', { name: 'Your account' }).count()).resolves.toBe(0);
  });

  it('signs out from the menu, and logs no warning about the theme', async () => {
    const page = await signedInPage({ isPhone });
    const warnings = controlledWarnings(page);

    await visible(page, 'avatar-menu').click();
    await page.getByText(/^This session: Device · .*Chrome, since/).filter({ visible: true }).waitFor();
    await visible(page, 'avatar-menu-sign-out').click();
    await page.waitForURL(`${web.url}/sign-in`);

    expect(warnings).toEqual([]);
  });

  it('signs out from the menu', async () => {
    const page = await signedInPage({ isPhone });

    await visible(page, 'avatar-menu').click();
    await visible(page, 'avatar-menu-sign-out').click();

    await page.waitForURL(`${web.url}/sign-in`);
    await expect(page.context().cookies()).resolves.toEqual([]);
  });

  it('signs out with a call still answering, and that call does not set the session cookie again', async () => {
    let held: Awaited<ReturnType<typeof holdOneAnswer>> | undefined;
    const page = await signedInPage({ isPhone, beforeSignIn: async (newPage) => { held = await holdOneAnswer(newPage, 'fleet.harbour'); } });
    if (held === undefined) throw new Error('Harbour answer was not held');
    await held.reached;

    await visible(page, 'avatar-menu').click();
    await visible(page, 'avatar-menu-sign-out').click();
    // The console sends Sign out only once every call on its way has answered, so Sign out waits for the held answer: it is let go once the menu says it is signing out.
    await page.getByText('Signing out…').filter({ visible: true }).waitFor();
    held.release();
    await page.waitForURL(`${web.url}/sign-in`);
    await held.answered;
    await expect(page.context().cookies()).resolves.toEqual([]);
  });

  it('asks no console read once Sign out has ended the session', async () => {
    const page = await signedInPage({ isPhone });
    await visible(page, 'avatar-menu').click();
    let hasSessionEnded = false;
    const readsAfterSessionEnded: string[] = [];
    page.on('response', (response) => {
      if (new URL(response.url()).pathname.endsWith('/console.signOut') && response.ok()) {
        hasSessionEnded = true;
      }
    });
    page.on('request', (request) => {
      const { pathname } = new URL(request.url());
      if (hasSessionEnded && pathname.startsWith('/api/reads/')) {
        readsAfterSessionEnded.push(pathname);
      }
    });

    await visible(page, 'avatar-menu-sign-out').click();
    await page.waitForURL(`${web.url}/sign-in`);
    // The sign-in page is up: the page that sent Sign out is gone, and no later call is its.
    await page.getByLabel('Email').waitFor();
    await afterFrames(page);

    expect(hasSessionEnded).toBe(true);
    expect(readsAfterSessionEnded).toEqual([]);
  });

  it('sends no call once Sign out has started, while its answer is slow', async () => {
    const page = await signedInPage({ isPhone });
    await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
    const signOut = holdSignOutSlow(page);

    await visible(page, 'avatar-menu').click();
    await visible(page, 'avatar-menu-sign-out').click();
    await signOut.started;
    // Coming back to the page while Sign out is on its way asks its reads again; TanStack Query hears it on window.
    await page.evaluate("window.dispatchEvent(new Event('visibilitychange'))");
    await afterFrames(page);
    signOut.release();
    await page.waitForURL(`${web.url}/sign-in`);
    // The sign-in page is up: the page that sent Sign out is gone, and no later call is its.
    await page.getByLabel('Email').waitFor();
    await afterFrames(page);

    expect(signOut.callsSent).toEqual([]);
  });

  it('asks again as usual once Sign out has failed, as the operator is still signed in', async () => {
    const page = await signedInPage({ isPhone });
    await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
    await page.route(
      (url) => url.pathname.endsWith('/console.signOut'),
      (route) => route.abort(),
    );
    let hasSignOutFailed = false;
    const callsAfterSignOutFailed: string[] = [];
    page.on('requestfailed', (request) => {
      if (new URL(request.url()).pathname.endsWith('/console.signOut')) {
        hasSignOutFailed = true;
      }
    });
    page.on('request', (request) => {
      const { pathname } = new URL(request.url());
      if (hasSignOutFailed && pathname.startsWith('/trpc/')) {
        callsAfterSignOutFailed.push(pathname);
      }
    });

    await visible(page, 'avatar-menu').click();
    await visible(page, 'avatar-menu-sign-out').click();
    await page.getByText('Couldn’t sign out').waitFor();

    await expect.poll(() => callsAfterSignOutFailed.length).toBeGreaterThan(0);
  });

  it('signs out without sending any write but Sign out', async () => {
    const page = await signedInPage({ isPhone });
    await visible(page, 'avatar-menu').click();
    const writesSent: string[] = [];
    page.on('request', (request) => {
      const { pathname } = new URL(request.url());
      if (request.method() === 'POST' && pathname.startsWith('/trpc/')) {
        writesSent.push(...pathname.slice('/trpc/'.length).split(','));
      }
    });

    await visible(page, 'avatar-menu-sign-out').click();
    await page.waitForURL(`${web.url}/sign-in`);
    // The sign-in page is up: the page that sent Sign out is gone, and no later call is its.
    await page.getByLabel('Email').waitFor();
    await afterFrames(page);

    expect(writesSent).toEqual(['console.signOut']);
  });
});

describe('Settings as the mockups draw it (docs/design/app-navigation, where the account menu\'s items go)', () => {
  it('holds its sections in one column about 712 px wide on desktop', async () => {
    // Given argo signed in on desktop
    const page = await signedInPage({ isPhone: false });

    // When argo opens Settings
    await openSettings(page);

    // Then each section is as wide as the mockup's column, not the page
    const theme = await page.getByRole('region', { name: 'Theme' }).boundingBox();
    const help = await page.getByRole('region', { name: 'Help' }).boundingBox();
    expect([theme?.width, help?.width]).toEqual([712, 712]);
  });

  it('puts Network first on phone, above Theme, where the tab bar has no room for it', async () => {
    // Given argo, who may edit the network, signed in on a phone
    const page = await signedInPage({ isPhone: true });

    // When argo opens Settings
    await openSettings(page);

    // Then the Network row comes first, above the Theme section
    const network = await page.getByRole('main').getByRole('link', { name: 'Network' }).boundingBox();
    const theme = await page.getByRole('heading', { name: 'Theme', level: 2 }).boundingBox();
    expect(network).not.toBeNull();
    expect(theme).not.toBeNull();
    expect(network?.y ?? Infinity).toBeLessThan(theme?.y ?? 0);
  });
});

/** The theme this browser keeps in the cookie every Aeolus app reads; undefined without one. */
async function themeCookieOf(page: Page): Promise<string | undefined> {
  return (await page.context().cookies()).find((cookie) => cookie.name === THEME_COOKIE)?.value;
}

/** The page shows live once hydrated: a menu click before that does nothing. */
async function hydrated(page: Page): Promise<void> {
  await page.getByText('Live', { exact: true }).filter({ visible: true }).first().waitFor({ timeout: 20_000 });
}
