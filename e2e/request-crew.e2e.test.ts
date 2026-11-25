import type { ShipId } from '@aeolus-fleet/common';
import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext } from 'playwright';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../packages/core/src/adapters/prisma/client.js';
import { createApp } from '../packages/core/src/app.js';
import { createMigratedDatabase } from '../packages/core/src/testing/database.js';
import { newKey } from '../packages/core/src/testing/keys.js';
import { unwrap } from '../packages/core/src/testing/result.js';
import { createUseCases } from '../packages/core/src/wiring.js';
import { FLEET_URL, OPERATOR, operatorCaller } from '../packages/core/test/support/core-fixtures.js';
import { withOperatorLogin } from '../packages/core/test/support/operator-login.js';
import { createTestClock } from '../packages/core/test/support/postgres-core.js';
import { signIn } from './support/console.js';
import { startFakeTrierarchPlugin, type FakeTrierarchPlugin } from './support/fake-trierarch-plugin.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';

// Issue 2086: hold the first plugin reads so a press on the ship page races them.
const clock = createTestClock('2026-10-25T12:00:00.000Z');
let database: PrismaClient;
let server: FastifyInstance;
let plugin: FakeTrierarchPlugin;
let web: RunningWeb;
let browser: Browser;
let context: BrowserContext | undefined;
let shipId: ShipId;

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  const useCases = createUseCases({ prisma: database, clock });
  const fleet = unwrap(await withOperatorLogin(database, useCases.initialiseFleet({ name: 'home fleet' })));
  ({ shipId } = unwrap(await useCases.commissionShip(operatorCaller(fleet), { idempotencyKey: newKey(), name: 'scout', type: 'scout' })));
  const webUrl = await reserveWebUrl();
  server = createApp({ databaseUrl, publicUrl: FLEET_URL, consoleOrigin: webUrl, clock, logger: false });
  const serverUrl = await server.listen({ host: '127.0.0.1', port: 0 });
  plugin = await startFakeTrierarchPlugin();
  web = await startWeb({ url: webUrl, serverUrl, trierarchPluginUrl: plugin.url });
  browser = await launchChromium();
});

afterEach(async () => {
  await context?.close();
  context = undefined;
});

afterAll(async () => {
  await browser.close();
  await web.stop();
  await plugin.stop();
  await server.close();
  await database.$disconnect();
});

it('opens the crew dialog without writing a request when the plugin reads are slow', async () => {
  // Given a ship with no request and a connected plugin whose answers are held.
  context = await browser.newContext({ baseURL: web.url, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.clock.setFixedTime(clock.now());
  await signIn(page, OPERATOR);
  await page.getByTestId('fleet-commission').waitFor();
  const connection = Promise.withResolvers<undefined>();
  const machines = Promise.withResolvers<undefined>();
  await page.route('**/api/reads/trierarch-plugin-connection', async (route) => {
    await connection.promise;
    await route.continue();
  });
  await page.route('**/api/reads/machines', async (route) => {
    await machines.promise;
    await route.continue();
  });

  try {
    // When the operator presses Request crew before the plugin answers.
    await page.goto(`/ships/${shipId}`);
    const request = page.getByTestId('crew-request-request');
    await request.waitFor();
    const wasEnabled = await request.isEnabled();
    await request.click({ force: true });

    // Then the early press is disabled. A press after the connection answers
    // opens the dialog even while the machines are still loading.
    expect(wasEnabled).toBe(false);
    connection.resolve(undefined);
    await request.click();
    const dialog = page.getByTestId('request-crew-dialog');
    await dialog.getByText('Loading the trierarch plugin’s options.').waitFor();
    machines.resolve(undefined);
    await dialog.getByTestId('request-crew-submit').waitFor();
    expect(await database.crewRequest.findFirst({ where: { shipId } })).toBeNull();
  } finally {
    connection.resolve(undefined);
    machines.resolve(undefined);
  }
});


it('writes a manual crew request in one click when the trierarch plugin is off', async () => {
  // Given a ship with no request and the trierarch plugin off.
  context = await browser.newContext({ baseURL: web.url, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.clock.setFixedTime(clock.now());
  await signIn(page, OPERATOR);
  await page.getByTestId('fleet-commission').waitFor();
  await page.route('**/api/reads/trierarch-plugin-connection', (route) =>
    route.fulfill({ json: { kind: 'answered', data: { state: 'none' } } }),
  );
  await page.goto(`/ships/${shipId}`);

  // When the operator requests crew.
  await page.getByTestId('crew-request-request').click();

  // Then the manual request is written without settings.
  await expect.poll(() => database.crewRequest.findFirst({ where: { shipId } })).toMatchObject({ settings: {}, assignedTo: null });
});
