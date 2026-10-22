import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Locator, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../packages/core/src/adapters/prisma/client.js';
import { createApp } from '../packages/core/src/app.js';
import { createMigratedDatabase } from '../packages/core/src/testing/database.js';
import { newKey } from '../packages/core/src/testing/keys.js';
import { unwrap } from '../packages/core/src/testing/result.js';
import { createUseCases } from '../packages/core/src/wiring.js';
import { FLEET_URL, OPERATOR, operatorCaller } from '../packages/core/test/support/core-fixtures.js';
import { withOperatorLogin } from '../packages/core/test/support/operator-login.js';
import { signIn } from './support/console.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';

// The fleet overview's filter bar stays in line (#1116, docs/design/png/FleetTable.png):
// on desktop the search, the filters, Show retired and the ship count share
// one row, also when the filters take more than the row's width; on phone
// the search and the Filter ships button share one.

/** A desktop too narrow for every filter on one row. */
const NARROW_DESKTOP = { width: 1024, height: 800 };
const PHONE = { width: 390, height: 844 };
/** In line: middles within a pixel, as centring a 20 px switch in a 32 px row rounds. */
const IN_LINE_PX = 1;

let database: PrismaClient;
let server: FastifyInstance;
let web: RunningWeb;
let browser: Browser;
const contexts: BrowserContext[] = [];

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  const useCases = createUseCases({ prisma: database });
  const fleet = unwrap(await withOperatorLogin(database, useCases.initialiseFleet({ name: 'home fleet' })));
  unwrap(await useCases.commissionShip(operatorCaller(fleet), { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
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

async function overviewAt(viewport: { width: number; height: number }, isPhone = false): Promise<Page> {
  const context = await browser.newContext({ baseURL: web.url, viewport, ...(isPhone ? { isMobile: true, hasTouch: true } : {}) });
  contexts.push(context);
  const page = await context.newPage();
  await signIn(page, OPERATOR);
  await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
  await page.getByText('of 2 ships').waitFor();
  return page;
}

/** The vertical middle of what the locator finds, in whole pixels. */
async function middleOf(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error('not shown');
  }
  return Math.round(box.y + box.height / 2);
}

describe("the fleet overview's filter bar", () => {
  it('keeps the search, the first filter, Show retired and the ship count on one row on a desktop too narrow for every filter', async () => {
    const page = await overviewAt(NARROW_DESKTOP);
    const row = await middleOf(page.getByTestId('fleet-filter-status'));

    const middles = await Promise.all([middleOf(page.getByTestId('fleet-search')), middleOf(page.getByTestId('fleet-show-retired')), middleOf(page.getByText('of 2 ships'))]);

    expect(middles.map((middle) => Math.abs(middle - row) <= IN_LINE_PX)).toEqual([true, true, true]);
  });

  it('keeps the search and the Filter ships button on one row on phone', async () => {
    const page = await overviewAt(PHONE, true);

    const middles = await Promise.all([middleOf(page.getByTestId('fleet-search')), middleOf(page.getByTestId('fleet-filters-open'))]);

    expect(Math.abs(middles[0] - middles[1])).toBeLessThanOrEqual(IN_LINE_PX);
  });
});
