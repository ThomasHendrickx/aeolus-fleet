import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createPrismaClient, type PrismaClient } from '../packages/core/src/adapters/prisma/client.js';
import { createApp } from '../packages/core/src/app.js';
import { createUseCases, type UseCases } from '../packages/core/src/wiring.js';
import { FLEET_URL, OPERATOR } from '../packages/core/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../packages/core/test/support/database.js';
import { createTestClock } from '../packages/core/test/support/postgres-core.js';
import { unwrap } from '../packages/core/test/support/result.js';
import { createTrierarchPluginApp, type TrierarchPluginApp } from '../packages/trierarch-plugin/src/app.js';
import { createPluginDatabase } from '../packages/trierarch-plugin/test/support/database.js';
import { signIn } from './support/console.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';

// The Trierarchs section, end to end (#245): a console with the trierarch
// plugin and without squadrons offers Settings for it; the operator connects
// it there, the web app's server commissions trierarch-plugin and hands its
// secret over, and no secret reaches the browser. Trierarchs then lists no
// machine until the operator joins one, whose setup line shows once.

const clock = createTestClock('2026-10-07T12:00:00.000Z');
/** Sign-ins are rate limited per window; each test signs in after the window of the one before. */
const SIGN_IN_WINDOW_MS = 60_000;

let database: PrismaClient;
let useCases: UseCases;
let server: FastifyInstance;
let plugin: TrierarchPluginApp;
let pluginUrl: string;
let web: RunningWeb;
let browser: Browser;
const contexts: BrowserContext[] = [];

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  useCases = createUseCases({ prisma: database, clock });
  unwrap(await useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR }));

  const webUrl = await reserveWebUrl();
  server = createApp({ databaseUrl, publicUrl: FLEET_URL, consoleOrigin: webUrl, clock, logger: false });
  const serverUrl = await server.listen({ host: '127.0.0.1', port: 0 });
  plugin = createTrierarchPluginApp({ databaseUrl: await createPluginDatabase(), fleetUrl: serverUrl, logger: false });
  await plugin.restoreConnections();
  pluginUrl = await plugin.server.listen({ host: '127.0.0.1', port: 0 });
  web = await startWeb({ url: webUrl, serverUrl, trierarchPluginUrl: pluginUrl });
  browser = await launchChromium();
});

afterAll(async () => {
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
  await web.stop();
  await plugin.close();
  await server.close();
  await database.$disconnect();
});

async function signedIn(): Promise<Page> {
  clock.advance(SIGN_IN_WINDOW_MS);
  const context = await browser.newContext({ baseURL: web.url });
  contexts.push(context);
  const page = await context.newPage();
  await signIn(page, OPERATOR);
  await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
  return page;
}

/** How many fleets the trierarch plugin's health says it is connected to. */
async function pluginConnectedFleets(): Promise<number> {
  return z.object({ connectedFleets: z.number() }).parse(await (await fetch(`${pluginUrl}/api/health`)).json()).connectedFleets;
}

describe('Trierarchs in the console', () => {
  it('connects the trierarch plugin from Settings as trierarch-plugin, which may assign crew requests, and the browser never gets the secret', async () => {
    const page = await signedIn();
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('settings-trierarchs-state').textContent()).resolves.toContain('Not connected');

    const [answer] = await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/trierarch-plugin/connection') && response.request().method() === 'POST'),
      page.getByTestId('settings-trierarchs-connect').click(),
    ]);

    await page.getByTestId('settings-trierarchs').getByText('Connected as').waitFor();
    expect(await answer.text()).not.toMatch(/aeolus_sk_v1/);
    const ship = await database.ship.findFirstOrThrow({ where: { name: 'trierarch-plugin', retiredAt: null } });
    expect(ship).toMatchObject({ type: 'trierarch-plugin', scopes: ['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage', 'crew:assign'] });
    await expect(pluginConnectedFleets()).resolves.toBe(1);
  });

  it('lists no machine, then joins one: its setup line shows once, and it is listed as not started', async () => {
    const page = await signedIn();
    await page.getByTestId('nav-trierarchs').click();
    await page.getByText('No machines yet').waitFor();

    await page.getByTestId('trierarchs-join').click();
    await page.getByTestId('join-machine-name').fill('trierarch-mac');
    await page.getByTestId('join-machine-submit').click();

    const setupLine = await page.getByTestId('join-machine-setup-line').textContent();
    expect(setupLine).toContain('npx @aeolus-fleet/trierarch init');
    await page.getByTestId('join-machine-dialog').getByRole('button', { name: 'Done' }).click();
    const card = page.getByTestId('machine-card');
    await card.getByText('trierarch-mac').waitFor();
    await expect(card.getByTestId('machine-liveness').getAttribute('data-liveness')).resolves.toBe('not-started');
    // A trierarch that never ran is not silent: nothing to count yet.
    await expect(page.getByTestId('nav-trierarchs-count').count()).resolves.toBe(0);
  });
});
