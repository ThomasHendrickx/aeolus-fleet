import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../packages/core/src/adapters/prisma/client.js';
import { createApp } from '../packages/core/src/app.js';
import { createUseCases } from '../packages/core/src/wiring.js';
import { FLEET_URL, OPERATOR } from '../packages/core/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../packages/core/src/testing/database.js';
import { createTestClock } from '../packages/core/test/support/postgres-core.js';
import { withOperatorLogin } from '../packages/core/test/support/operator-login.js';
import { signIn } from './support/console.js';
import { startFakeTrierarchPlugin, type FakeTrierarchPlugin } from './support/fake-trierarch-plugin.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';

// Model governance, end to end (#375): argo enables the fleet's first model on
// the Trierarchs page, confirming that it changes the whole fleet, and the
// Commission form then offers only that model. The trierarch plugin is a fake
// that keeps the enabled models; the console, the server and Postgres are real.

const clock = createTestClock('2026-10-25T12:00:00.000Z');

let database: PrismaClient;
let server: FastifyInstance;
let plugin: FakeTrierarchPlugin;
let web: RunningWeb;
let browser: Browser;
let context: BrowserContext | undefined;

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  const useCases = createUseCases({ prisma: database, clock });
  await withOperatorLogin(database, useCases.initialiseFleet({ name: 'home fleet' }));
  const webUrl = await reserveWebUrl();
  server = createApp({ databaseUrl, publicUrl: FLEET_URL, consoleOrigin: webUrl, clock, logger: false });
  const serverUrl = await server.listen({ host: '127.0.0.1', port: 0 });
  plugin = await startFakeTrierarchPlugin();
  web = await startWeb({ url: webUrl, serverUrl, trierarchPluginUrl: plugin.url });
  browser = await launchChromium();
});

afterAll(async () => {
  await context?.close();
  await browser.close();
  await web.stop();
  await plugin.stop();
  await server.close();
  await database.$disconnect();
});

describe('model governance', () => {
  it('enables the first model after a confirm, and the Commission form then offers only it', async () => {
    context = await browser.newContext({ baseURL: web.url });
    const page = await context.newPage();
    await signIn(page, OPERATOR);
    // Signed in once the overview shows, before going anywhere else.
    await page.getByTestId('fleet-commission').waitFor();

    await page.goto('/trierarchs');
    const models = page.getByTestId('trierarchs-models');
    const rule = models.getByTestId('trierarchs-models-rule');
    await rule.filter({ hasText: 'Every model is allowed. Enable a model to allow only the enabled ones.' }).waitFor();
    await models.getByRole('switch', { name: 'claude-sonnet-5-5: disabled' }).click();
    const confirm = page.getByTestId('model-rule-dialog');
    await confirm.getByText('Allow only enabled models?').waitFor();
    await confirm.getByTestId('model-rule-confirm').click();
    await page.getByText('claude-sonnet-5-5 enabled').waitFor();
    await rule.filter({ hasText: 'Only enabled models are placed. Crews already running keep their model.' }).waitFor();
    expect(plugin.enabledModels()).toEqual(['claude-sonnet-5-5']);

    // In the console, as the operator goes: Request a crew is on while the plugin is connected.
    await page.getByTestId('nav-overview').click();
    await page.getByTestId('fleet-commission').click();
    const dialog = page.getByTestId('commission-dialog');
    const model = dialog.getByTestId('crew-settings-option-model');
    await model.filter({ hasText: 'claude-sonnet-5-5' }).waitFor();
    await model.click();
    await page.getByRole('option').first().waitFor();
    // The first enabled model is the default, as claude-opus-5-5, the reported one, is disabled.
    expect(await page.getByRole('option').allTextContents()).toEqual(['claude-sonnet-5-5 (default)']);
  });
});
