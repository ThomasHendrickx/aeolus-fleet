import { idSchema } from '@aeolus-fleet/common';
import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createPrismaClient, type PrismaClient } from '../packages/server/src/adapters/prisma/client.js';
import { createApp } from '../packages/server/src/app.js';
import type { Caller } from '../packages/server/src/core/shared/caller.js';
import { createUseCases, type UseCases } from '../packages/server/src/wiring.js';
import { FLEET_URL, OPERATOR, operatorCaller } from '../packages/server/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../packages/server/test/support/database.js';
import { newKey } from '../packages/server/test/support/keys.js';
import { createTestClock } from '../packages/server/test/support/postgres-core.js';
import { unwrap } from '../packages/server/test/support/result.js';
import { createSquadronsApp, type SquadronsApp } from '../packages/squadrons/src/app.js';
import { createSquadronsDatabase } from '../packages/squadrons/test/support/database.js';
import { signIn, openRowMenu } from './support/console.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';

// Connect squadrons, end to end: squadrons starts not connected; the operator
// connects it from Settings, the web app's server commissions the management
// ship and hands its secret to squadrons, and no secret reaches the browser.
// Once the operator releases that ship, the same button connects it again.

const clock = createTestClock('2026-10-03T12:00:00.000Z');
/** Sign-ins are rate limited per window; each test signs in after the window of the one before. */
const SIGN_IN_WINDOW_MS = 60_000;
/** Longer than three refresh cycles of the squadrons list (5 s each), with its retries. */
const STEADY_FOR_MS = 16_000;
const SAMPLE_EVERY_MS = 250;

let database: PrismaClient;
let useCases: UseCases;
let argo: Caller;
let server: FastifyInstance;
let squadrons: SquadronsApp;
let squadronsUrl: string;
let web: RunningWeb;
let browser: Browser;
const contexts: BrowserContext[] = [];

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  useCases = createUseCases({ prisma: database, clock, fleetUrl: FLEET_URL });
  argo = operatorCaller(unwrap(await useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR })));

  const webUrl = await reserveWebUrl();
  server = createApp({ databaseUrl, publicUrl: FLEET_URL, consoleOrigin: webUrl, clock, logger: false });
  const serverUrl = await server.listen({ host: '127.0.0.1', port: 0 });
  squadrons = createSquadronsApp({ databaseUrl: await createSquadronsDatabase(), fleetUrl: serverUrl, cacheDir: '/tmp/aeolus-squadrons-e2e', logger: false });
  await squadrons.readConnection();
  squadronsUrl = await squadrons.server.listen({ host: '127.0.0.1', port: 0 });
  web = await startWeb({ url: webUrl, serverUrl, squadronsUrl });
  browser = await launchChromium();
});

afterAll(async () => {
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
  await web.stop();
  await squadrons.close();
  await server.close();
  await database.$disconnect();
});

async function settingsPage(): Promise<Page> {
  clock.advance(SIGN_IN_WINDOW_MS);
  const context = await browser.newContext({ baseURL: web.url });
  contexts.push(context);
  const page = await context.newPage();
  await signIn(page, OPERATOR);
  await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
  await page.getByTestId('nav-settings').click();
  await page.getByRole('heading', { name: 'Squadrons' }).waitFor();
  return page;
}

async function squadronsHealth(): Promise<string> {
  return z.object({ connection: z.string() }).parse(await (await fetch(`${squadronsUrl}/api/health`)).json()).connection;
}

describe('Settings, Squadrons', () => {
  it("asks squadrons only for its connection while it is configured but not connected, and keeps a ship's plain actions steady", async () => {
    unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'reviewer-02', type: 'reviewer' }));
    clock.advance(SIGN_IN_WINDOW_MS);
    const context = await browser.newContext({ baseURL: web.url });
    contexts.push(context);
    const page = await context.newPage();
    const squadronsCalls: string[] = [];
    page.on('request', (request) => {
      const { pathname } = new URL(request.url());
      if (pathname.startsWith('/api/squadrons/') || pathname.startsWith('/squadrons/')) {
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

    expect(shown.every((count) => count === 1)).toBe(true);
    expect(new Set(squadronsCalls)).toEqual(new Set(['GET /squadrons/connection']));
  });

  it('connects squadrons as a new management ship with fleet read and manage, and the browser never gets the secret', async () => {
    const page = await settingsPage();
    await expect(page.getByTestId('settings-squadrons-state').textContent()).resolves.toContain('Not connected');

    const [answer] = await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/squadrons/connection') && response.request().method() === 'POST'),
      page.getByTestId('settings-squadrons-connect').click(),
    ]);

    await page.getByText('Connected as').waitFor();
    expect(await answer.text()).not.toMatch(/aeolus_sk_v1|Ship secret/);
    const ship = await database.ship.findFirstOrThrow({ where: { name: 'squadrons', retiredAt: null } });
    expect(ship).toMatchObject({ type: 'squadrons', scopes: ['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage'] });
    await expect(squadronsHealth()).resolves.toBe('connected');
  });

  it('connects the same ship again once the operator released it', async () => {
    const ship = await database.ship.findFirstOrThrow({ where: { name: 'squadrons', retiredAt: null } });
    unwrap(await useCases.releaseShip(argo, { shipId: idSchema('ship').parse(ship.id) }));
    const page = await settingsPage();
    await page.getByText('Not connected').waitFor();

    await page.getByTestId('settings-squadrons-connect').click();

    await page.getByText('Connected as').waitFor();
    await expect(database.ship.count({ where: { name: 'squadrons' } })).resolves.toBe(1);
    await expect(squadronsHealth()).resolves.toBe('connected');
  });
});
