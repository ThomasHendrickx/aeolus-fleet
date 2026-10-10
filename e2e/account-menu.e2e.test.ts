import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../packages/core/src/adapters/prisma/client.js';
import { createApp } from '../packages/core/src/app.js';
import { createUseCases, type UseCases } from '../packages/core/src/wiring.js';
import { FLEET_URL, OPERATOR } from '../packages/core/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../packages/core/test/support/database.js';
import { createTestClock } from '../packages/core/test/support/postgres-core.js';
import { unwrap } from '../packages/core/test/support/result.js';
import { signIn } from './support/console.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';

// The AccountMenu, end to end, on desktop and on phone: the session's device
// and the operator's theme, which applies at once and comes back from the
// account on the next load, and Sign out.

const clock = createTestClock('2026-10-01T09:00:00.000Z');
/** Sign-ins are rate limited per window; each test signs in after the window of the one before. */
const SIGN_IN_WINDOW_MS = 60_000;
/** How long after Sign out the reads the page asks are counted. */
const AFTER_SIGN_OUT_MS = 3_000;
/** Each read may be asked once more as the console forgets what it loaded, and once for a page still on its way out; never in a loop. */
const MOST_ASKS_AFTER_SIGN_OUT = 2;

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
  unwrap(await useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR }));

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

async function signedInPage(options: { isPhone: boolean }): Promise<Page> {
  clock.advance(SIGN_IN_WINDOW_MS);
  const context = await browser.newContext({ baseURL: web.url, ...(options.isPhone ? PHONE : {}) });
  contexts.push(context);
  const page = await context.newPage();
  await signIn(page, OPERATOR);
  await page.waitForURL(`${web.url}/`);
  return page;
}

function visible(page: Page, testId: string) {
  return page.locator(`[data-testid="${testId}"]:visible`);
}

async function isDark(page: Page): Promise<boolean> {
  const classes = (await page.locator('html').getAttribute('class')) ?? '';
  return classes.split(/\s+/).includes('dark');
}

describe.each([
  ['desktop', false],
  ['phone', true],
])('the AccountMenu on %s', (_device, isPhone) => {
  it('shows this session, switches the theme at once and keeps it on the account for the next load', async () => {
    const page = await signedInPage({ isPhone });

    await visible(page, 'account-menu').click();
    await visible(page, 'account-session').getByText(/Device · .*Chrome, since/).waitFor();
    await visible(page, 'account-theme-dark').click();

    await expect.poll(() => isDark(page)).toBe(true);
    await expect
      .poll(async () => (await database.operator.findFirstOrThrow()).theme)
      .toBe('dark');
    await page.reload();
    await expect.poll(() => isDark(page)).toBe(true);

    await visible(page, 'account-menu').click();
    await visible(page, 'account-theme-light').click();
    await expect.poll(() => isDark(page)).toBe(false);
    await expect
      .poll(async () => (await database.operator.findFirstOrThrow()).theme)
      .toBe('light');
    await page.reload();
    await expect.poll(() => isDark(page)).toBe(false);
  });

  it('links to the source on GitHub, opening in a new tab: in the Sidebar foot on desktop, in the account sheet on phone', async () => {
    const page = await signedInPage({ isPhone });
    if (isPhone) {
      await visible(page, 'account-menu').click();
    }
    const source = visible(page, isPhone ? 'account-source' : 'nav-source');

    await expect(source.getAttribute('href')).resolves.toBe('https://github.com/ThomasHendrickx/aeolus-fleet');
    await expect(source.getAttribute('target')).resolves.toBe('_blank');
  });

  it('offers no Your account on a self-hosted console', async () => {
    const page = await signedInPage({ isPhone });

    await visible(page, 'account-menu').click();

    await visible(page, 'account-session').waitFor();
    await expect(visible(page, 'account-hosted').count()).resolves.toBe(0);
  });

  it('signs out from the menu', async () => {
    const page = await signedInPage({ isPhone });

    await visible(page, 'account-menu').click();
    await visible(page, 'account-sign-out').click();

    await page.waitForURL(`${web.url}/sign-in`);
    await expect(page.context().cookies()).resolves.toEqual([]);
  });

  it('signs out without asking the console reads again and again', async () => {
    const page = await signedInPage({ isPhone });
    await visible(page, 'account-menu').click();
    const readsAsked: string[] = [];
    page.on('request', (request) => {
      const { pathname } = new URL(request.url());
      if (pathname.startsWith('/api/reads/')) {
        readsAsked.push(pathname);
      }
    });

    await visible(page, 'account-sign-out').click();
    await new Promise((resolve) => setTimeout(resolve, AFTER_SIGN_OUT_MS));

    const mostAsked = Math.max(0, ...readsAsked.map((read) => readsAsked.filter((asked) => asked === read).length));
    expect(mostAsked).toBeLessThanOrEqual(MOST_ASKS_AFTER_SIGN_OUT);
  });
});
