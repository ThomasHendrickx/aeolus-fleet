import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../packages/server/src/adapters/prisma/client.js';
import { createApp } from '../packages/server/src/app.js';
import type { Caller } from '../packages/server/src/core/shared/caller.js';
import { createUseCases, type UseCases } from '../packages/server/src/wiring.js';
import { FLEET_URL, OPERATOR, operatorCaller } from '../packages/server/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../packages/server/test/support/database.js';
import { createTestClock } from '../packages/server/test/support/postgres-core.js';
import { unwrap } from '../packages/server/test/support/result.js';
import { signIn } from './support/console.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';
import { newKey } from '../packages/server/test/support/keys.js';

// The CommandPalette, end to end: Cmd+K or the Header's search opens it on
// desktop, the TopBar's search icon full screen on phone; a ship opens its
// page, Commission ship the CommissionDialog, a page its route.

const clock = createTestClock('2026-10-01T09:00:00.000Z');
/** Sign-ins are rate limited per window; each test signs in after the window of the one before. */
const SIGN_IN_WINDOW_MS = 60_000;

let database: PrismaClient;
let useCases: UseCases;
let argo: Caller;
let server: FastifyInstance;
let web: RunningWeb;
let browser: Browser;
const contexts: BrowserContext[] = [];

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  useCases = createUseCases({ prisma: database, clock });
  argo = operatorCaller(unwrap(await useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR })));

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

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

async function signedInPage(options: { isPhone?: boolean } = {}): Promise<Page> {
  clock.advance(SIGN_IN_WINDOW_MS);
  const context = await browser.newContext({ baseURL: web.url, ...(options.isPhone === true ? PHONE : {}) });
  contexts.push(context);
  const page = await context.newPage();
  await signIn(page, OPERATOR);
  await page.waitForURL(`${web.url}/`);
  return page;
}

function palette(page: Page) {
  return page.getByTestId('command-palette');
}

describe('the CommandPalette', () => {
  it('opens on Cmd+K and opens a ship found by name', async () => {
    const { shipId } = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'reviewer-01', type: 'reviewer' }));
    const page = await signedInPage();
    await page.getByTestId('header-search').waitFor();

    await page.keyboard.press('ControlOrMeta+k');
    await palette(page).getByTestId('command-palette-input').fill('revi');
    await palette(page).locator(`[data-testid="command-palette-item"][data-item-id="${shipId}"]`).click();

    await page.waitForURL(`${web.url}/ships/${shipId}`);
    await palette(page).waitFor({ state: 'hidden' });
  });

  it('opens from the Header and runs Commission ship: the CommissionDialog opens', async () => {
    const page = await signedInPage();
    await page.goto('/needs-attention');

    await page.getByTestId('header-search').click();
    await palette(page).getByTestId('command-palette-input').fill('commission');
    await page.keyboard.press('Enter');

    await page.getByTestId('commission-dialog').waitFor();
    expect(page.url()).toBe(`${web.url}/?commission=new`);
  });

  it('opens full screen from the TopBar on phone and goes to a page', async () => {
    const page = await signedInPage({ isPhone: true });

    await page.getByTestId('top-bar-search').click();
    await palette(page).getByTestId('command-palette-input').fill('attention');
    await palette(page).locator('[data-testid="command-palette-item"][data-item-id="attention"]').click();

    await page.waitForURL(`${web.url}/needs-attention`);
  });
});
