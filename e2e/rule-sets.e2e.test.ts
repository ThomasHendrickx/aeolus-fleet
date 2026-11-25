import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { FastifyInstance } from 'fastify';
import type { Browser } from 'playwright';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createApp } from '../packages/core/src/app.js';
import type { AppRouter } from '../packages/core/src/index.js';
import { createMigratedDatabase } from '../packages/core/src/testing/database.js';
import { newKey } from '../packages/core/src/testing/keys.js';
import { FLEET_URL } from '../packages/core/test/support/core-fixtures.js';
import { startFakeTrierarchPlugin, type FakeTrierarchPlugin } from './support/fake-trierarch-plugin.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';

const INSTALLATION_TOKEN = 'aeolus_installation_test_rule_sets';
const GUARD_CATALOGUE = {
  version: 1,
  repositories: [{ repository: 'acme/guard-rules', folder: 'rules/', access: 'public', readCommit: '8d41e07a1234567890' }],
  sets: [
    { name: 'base', repository: 'acme/guard-rules', file: 'rules/base.yaml', commit: '8d41e07a1234567890', rulesCount: 6 },
    { name: 'docs-only', repository: 'acme/guard-rules', file: 'rules/docs-only.yaml', commit: '8d41e07a1234567890', rulesCount: 4 },
  ],
  errors: [],
  conflicts: [],
  floor: ['base'],
};

let server: FastifyInstance | undefined;
let web: RunningWeb | undefined;
let browser: Browser | undefined;
let plugin: FakeTrierarchPlugin | undefined;
let serverUrl: string;

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  const webUrl = await reserveWebUrl();
  server = createApp({ databaseUrl, publicUrl: FLEET_URL, consoleOrigin: webUrl, logger: false, installationToken: INSTALLATION_TOKEN });
  serverUrl = await server.listen({ host: '127.0.0.1', port: 0 });
  plugin = await startFakeTrierarchPlugin({ guardCatalogue: GUARD_CATALOGUE });
  web = await startWeb({ url: webUrl, serverUrl, trierarchPluginUrl: plugin.url });
  browser = await launchChromium();
});

afterAll(async () => {
  await browser?.close();
  await web?.stop();
  await plugin?.stop();
  await server?.close();
});

it('opens Rule sets from Machines and reads repository commits, rule counts and the floor', async () => {
  // Given a signed-in operator and a repository with two offered sets.
  if (browser === undefined || web === undefined) throw new Error('The console did not start');
  const installation = createTRPCClient<AppRouter>({
    links: [httpBatchLink({ url: `${serverUrl}/trpc`, headers: { 'x-aeolus-installation-token': INSTALLATION_TOKEN } })],
  }).installation;
  const { fleetId } = await installation.fleets.create.mutate({ requestId: newKey(), name: 'Acme', operatorEmail: 'guard@example.com' });
  const { ticket } = await installation.operators.issueSignInTicket.mutate({ fleetId });
  const context = await browser.newContext({ baseURL: web.url, reducedMotion: 'reduce' });
  try {
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date());
    await page.goto(`/sign-in/ticket?ticket=${encodeURIComponent(ticket)}`);
    await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
    await page.goto('/trierarchs');

    // When the operator opens the Rule sets tab.
    await page.getByTestId('trierarchs-rule-sets-tab').click({ timeout: 5000 });

    // Then the catalogue shows the exact committed reads, counts and floor.
    const repository = page.getByRole('row', { name: /acme\/guard-rules.*2 rule sets/ });
    const base = page.getByRole('row', { name: /^base / });
    await repository.getByText('8d41e07', { exact: true }).waitFor();
    await base.getByRole('cell', { name: '6', exact: true }).waitFor();
    await page.getByRole('row', { name: /^docs-only / }).getByRole('cell', { name: '4', exact: true }).waitFor();
    await expect.poll(async () => (await base.getByRole('switch', { checked: true }).count()) + (await base.getByRole('cell', { name: 'Yes', exact: true }).count())).toBe(1);
  } finally {
    await context.close();
  }
});
