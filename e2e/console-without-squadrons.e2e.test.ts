import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../packages/server/src/adapters/prisma/client.js';
import { createApp } from '../packages/server/src/app.js';
import type { Caller } from '../packages/server/src/core/shared/caller.js';
import { createUseCases, type UseCases } from '../packages/server/src/wiring.js';
import { FLEET_URL, OPERATOR, operatorCaller } from '../packages/server/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../packages/server/test/support/database.js';
import { newKey } from '../packages/server/test/support/keys.js';
import { createTestClock } from '../packages/server/test/support/postgres-core.js';
import { unwrap } from '../packages/server/test/support/result.js';
import { signIn, openRowMenu } from './support/console.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';

// A console without squadrons (no AEOLUS_SQUADRONS_URL), end to end: squadrons
// is a plugin, so the console makes no squadrons call at all, from the browser
// or its server, and every ship keeps its plain actions.

const clock = createTestClock('2026-10-03T12:00:00.000Z');
/** Longer than three refresh cycles of the squadrons list (5 s each), with its retries. */
const STEADY_FOR_MS = 16_000;
const SAMPLE_EVERY_MS = 250;

let database: PrismaClient;
let useCases: UseCases;
let argo: Caller;
let server: FastifyInstance;
let web: RunningWeb;
let browser: Browser;
let context: BrowserContext | undefined;

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  useCases = createUseCases({ prisma: database, clock });
  argo = operatorCaller(unwrap(await useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR })));
  const webUrl = await reserveWebUrl();
  server = createApp({ databaseUrl, publicUrl: FLEET_URL, consoleOrigin: webUrl, clock, logger: false });
  const serverUrl = await server.listen({ host: '127.0.0.1', port: 0 });
  web = await startWeb({ url: webUrl, serverUrl });
  browser = await launchChromium();
});

afterAll(async () => {
  await context?.close();
  await browser.close();
  await web.stop();
  await server.close();
  await database.$disconnect();
});

describe('a console without squadrons', () => {
  it("makes no squadrons call, shows no trace of squadrons, and keeps a ship's plain actions steady", async () => {
    unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'reviewer-02', type: 'reviewer' }));
    context = await browser.newContext({ baseURL: web.url });
    const page = await context.newPage();
    const squadronsCalls: string[] = [];
    page.on('request', (request) => {
      const { pathname } = new URL(request.url());
      if (pathname.startsWith('/api/squadrons/') || pathname.startsWith('/squadrons')) {
        squadronsCalls.push(`${request.method()} ${pathname}`);
      }
    });
    await signIn(page, OPERATOR);
    // The row menu stays open while the overview refreshes: what it offers must not change.
    await page.getByTestId('fleet-row-reviewer-02').waitFor();
    await openRowMenu(page, 'reviewer-02');
    await page.getByTestId('fleet-ship-retire').waitFor();

    const shown: number[] = [];
    for (const started = Date.now(); Date.now() - started < STEADY_FOR_MS; ) {
      shown.push(await page.getByTestId('fleet-ship-retire').count());
      await page.waitForTimeout(SAMPLE_EVERY_MS);
    }
    await page.keyboard.press('Escape');
    await page.getByTestId('nav-attention').click();
    await page.getByRole('heading', { name: 'Needs attention' }).first().waitFor();
    await page.getByTestId('nav-settings').click();
    await page.getByRole('heading', { name: 'Settings' }).first().waitFor();

    expect(shown.every((count) => count === 1)).toBe(true);
    expect(squadronsCalls).toEqual([]);
    await expect(page.getByTestId('nav-squadrons').count()).resolves.toBe(0);
    await expect(page.getByTestId('settings-squadrons').count()).resolves.toBe(0);
    await expect(page.getByText(/squadrons/i).count()).resolves.toBe(0);
  });
});
