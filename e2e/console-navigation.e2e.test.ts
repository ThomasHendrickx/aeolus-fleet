import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../packages/core/src/adapters/prisma/client.js';
import { createApp } from '../packages/core/src/app.js';
import { createMigratedDatabase } from '../packages/core/src/testing/database.js';
import { unwrap } from '../packages/core/src/testing/result.js';
import { createUseCases } from '../packages/core/src/wiring.js';
import { FLEET_URL, OPERATOR } from '../packages/core/test/support/core-fixtures.js';
import { withOperatorLogin } from '../packages/core/test/support/operator-login.js';
import { signIn } from './support/console.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';

// A click in the navigation answers at once (#1117): the item clicked shows
// it is opening its page while the web app's server answers, however long
// the server takes.

/** How long the test holds the server's answer to the click back: far longer than a click may wait for an answer. */
const SLOW_SERVER_MS = 3_000;
/** A click shows it is working within this. */
const AT_ONCE_MS = 1_000;

let database: PrismaClient;
let server: FastifyInstance;
let web: RunningWeb;
let browser: Browser;
const contexts: BrowserContext[] = [];

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  const useCases = createUseCases({ prisma: database });
  unwrap(await withOperatorLogin(database, useCases.initialiseFleet({ name: 'home fleet' })));
  const webUrl = await reserveWebUrl();
  server = createApp({ databaseUrl, publicUrl: FLEET_URL, consoleOrigin: webUrl, logger: false });
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

/** argo on the inbox, with the server's answer to a navigation to the fleet overview held back. */
async function onInboxWithSlowOverview(viewport?: { width: number; height: number }): Promise<Page> {
  const context = await browser.newContext({ baseURL: web.url, ...(viewport === undefined ? {} : { viewport, isMobile: true, hasTouch: true }) });
  contexts.push(context);
  const page = await context.newPage();
  await signIn(page, OPERATOR);
  await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
  await page.goto('/inbox');
  await page.getByRole('heading', { name: 'Inbox' }).waitFor();
  // The server's answer to the click, its page as React Server Components, comes late.
  await page.route(
    (url) => url.pathname === '/' && url.searchParams.has('_rsc'),
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, SLOW_SERVER_MS));
      await route.continue();
    },
  );
  return page;
}

describe('a click in the navigation', () => {
  it('shows at once that the fleet overview is opening, while the server is slow to answer', async () => {
    const page = await onInboxWithSlowOverview();

    const clickedAt = Date.now();
    await page.getByTestId('nav-overview').click();
    await page.getByTestId('nav-overview').getByRole('status').filter({ hasText: 'Opening' }).waitFor({ timeout: SLOW_SERVER_MS });

    expect(Date.now() - clickedAt).toBeLessThan(AT_ONCE_MS);
  });

  it("shows it in the phone's tab bar too", async () => {
    const page = await onInboxWithSlowOverview({ width: 390, height: 844 });

    const clickedAt = Date.now();
    await page.getByTestId('tab-fleet').click();
    await page.getByTestId('tab-fleet').getByRole('status').filter({ hasText: 'Opening' }).waitFor({ timeout: SLOW_SERVER_MS });

    expect(Date.now() - clickedAt).toBeLessThan(AT_ONCE_MS);
  });

  it('opens the page once the server answers, and the item no longer shows it is opening', async () => {
    const page = await onInboxWithSlowOverview();

    await page.getByTestId('nav-overview').click();

    await page.getByRole('heading', { name: 'Fleet overview' }).waitFor({ timeout: SLOW_SERVER_MS * 3 });
    await expect(page.getByTestId('nav-overview').getByRole('status').count()).resolves.toBe(0);
  });
});
