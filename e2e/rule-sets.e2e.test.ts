import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { FastifyInstance } from 'fastify';
import type { Browser } from 'playwright';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../packages/core/src/app.js';
import type { AppRouter } from '../packages/core/src/index.js';
import { createMigratedDatabase } from '../packages/core/src/testing/database.js';
import { newKey } from '../packages/core/src/testing/keys.js';
import { FLEET_URL } from '../packages/core/test/support/core-fixtures.js';
import { startFakeAccountApp, type FakeAccountApp } from './support/fake-account-app.js';
import { startFakeTrierarchPlugin, type FakeTrierarchPlugin } from './support/fake-trierarch-plugin.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';

const INSTALLATION_TOKEN = 'aeolus_installation_test_rule_sets';
const GUARD_CATALOGUE = {
  version: 1,
  repositories: [{ repository: 'acme/guard-rules', folder: 'rules/', access: 'private', readCommit: '8d41e07a1234567890' }],
  sets: [
    { name: 'base', repository: 'acme/guard-rules', file: 'rules/base.yaml', commit: '8d41e07a1234567890', rulesCount: 6 },
    { name: 'docs-only', repository: 'acme/guard-rules', file: 'rules/docs-only.yaml', commit: '8d41e07a1234567890', rulesCount: 4 },
  ],
  errors: [],
  conflicts: [],
  floor: ['base'],
};
const guardReplacement = z.strictObject({
  expectedVersion: z.number(),
  repositories: z.array(z.strictObject({ repository: z.string(), folder: z.string(), access: z.enum(['public', 'private']) })),
  floor: z.array(z.string()),
  secrets: z.array(z.string()),
  secretValues: z.record(z.string(), z.string()),
});

let server: FastifyInstance | undefined;
let web: RunningWeb | undefined;
let browser: Browser | undefined;
let plugin: FakeTrierarchPlugin | undefined;
let accountApp: FakeAccountApp | undefined;
let serverUrl: string;
let catalogue = GUARD_CATALOGUE;
const firstWrite = Promise.withResolvers<void>();
const receivedWrites: z.infer<typeof guardReplacement>[] = [];

function installation() {
  return createTRPCClient<AppRouter>({
    links: [httpBatchLink({ url: `${serverUrl}/trpc`, headers: { 'x-aeolus-installation-token': INSTALLATION_TOKEN } })],
  }).installation;
}

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  const webUrl = await reserveWebUrl();
  accountApp = await startFakeAccountApp();
  server = createApp({
    databaseUrl, publicUrl: FLEET_URL, consoleOrigin: webUrl, logger: false,
    installationToken: INSTALLATION_TOKEN, accountTokenIssuer: accountApp.url,
  });
  serverUrl = await server.listen({ host: '127.0.0.1', port: 0 });
  plugin = await startFakeTrierarchPlugin({
    guard: {
      read: () => catalogue,
      replace: async (input) => {
        const parsed = guardReplacement.safeParse(input);
        const refusal = { status: 400, body: { error: { message: 'Invalid guard configuration' } } };
        if (!parsed.success) return refusal;
        const { expectedVersion, repositories, floor } = parsed.data;
        receivedWrites.push(parsed.data);
        if (receivedWrites.length === 1) {
          await firstWrite.promise;
          return refusal;
        }
        if (expectedVersion !== catalogue.version) return { status: 409, body: { error: { message: 'The guard configuration changed' } } };
        const version = catalogue.version + 1;
        catalogue = {
          ...catalogue,
          repositories: repositories.map((repository) => ({ ...repository, readCommit: '8d41e07a1234567890' })),
          version,
          floor,
        };
        return { status: 200, body: { result: { data: { version } } } };
      },
    },
  });
  web = await startWeb({ url: webUrl, serverUrl, trierarchPluginUrl: plugin.url, accountApp });
  browser = await launchChromium();
});

afterAll(async () => {
  await browser?.close();
  await web?.stop();
  await plugin?.stop();
  await server?.close();
  await accountApp?.close();
});

it('opens Rule sets from Machines and reads repository commits, rule counts and the floor', async () => {
  // Given a signed-in operator and a repository with two offered sets.
  if (browser === undefined || web === undefined) throw new Error('The console did not start');
  const { fleetId } = await installation().fleets.create.mutate({ requestId: newKey(), name: 'Acme', operatorEmail: 'guard@example.com' });
  const { ticket } = await installation().operators.issueSignInTicket.mutate({ fleetId });
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
    await base.getByRole('cell', { name: 'Yes', exact: true }).waitFor();
    expect(await page.getByRole('switch').count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Add repository' }).count()).toBe(0);
  } finally {
    await context.close();
  }
});

it('keeps a private repository’s inputs on failure and shows the committed repository and floor after saving', async () => {
  // Given a signed-in account holding trierarch:guard and a private repository already in the catalogue.
  if (browser === undefined || web === undefined || accountApp === undefined) throw new Error('The console did not start');
  const { fleetId } = await installation().fleets.create.mutate({ requestId: newKey(), name: 'Acme', operatorEmail: 'manager@example.com' });
  accountApp.signInAs({
    id: 'acc-guard-manager', email: 'manager@acme.example',
    fleets: [{ id: fleetId, name: 'Acme', scopes: ['fleet:read', 'fleet:manage', 'trierarch:guard'] }],
  });
  const context = await browser.newContext({ baseURL: web.url, reducedMotion: 'reduce' });
  try {
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date());
    await page.goto('/');
    await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
    await page.goto('/trierarchs/rule-sets');
    await page.getByTestId('rule-sets-add-repository').click({ timeout: 5000 });
    const dialog = page.getByRole('dialog', { name: 'Add repository' });
    await dialog.getByTestId('rule-sets-repository').fill('acme/more-rules');
    await dialog.getByTestId('rule-sets-private').click();
    await dialog.getByTestId('rule-sets-read-token').fill('test-example-value');

    // When the first replacement is held, then refused, and the account saves again.
    await dialog.getByTestId('rule-sets-submit').click();
    await expect.poll(() => dialog.getByTestId('rule-sets-submit').getAttribute('aria-busy')).toBe('true');
    firstWrite.resolve();
    await dialog.getByRole('alert').getByText('Invalid guard configuration', { exact: true }).waitFor();
    await expect.poll(() => dialog.getByTestId('rule-sets-repository').inputValue()).toBe('acme/more-rules');
    await expect.poll(() => dialog.getByTestId('rule-sets-read-token').inputValue()).toBe('test-example-value');
    await dialog.getByTestId('rule-sets-submit').click();

    // Then the committed repository is shown and the existing private token was retained by name.
    await page.getByRole('row', { name: /^acme\/more-rules / }).waitFor();
    await dialog.waitFor({ state: 'hidden' });
    expect(receivedWrites[1]).toMatchObject({ expectedVersion: 1, secrets: ['acme/guard-rules', 'acme/more-rules'] });
    expect(Object.keys(receivedWrites[1]?.secretValues ?? {})).toEqual(['acme/more-rules']);
    await page.getByTestId('rule-sets-floor-docs-only').filter({ visible: true }).click();
    await page.getByRole('switch', { name: 'Floor for docs-only', checked: true }).waitFor();
    expect(catalogue.floor).toEqual(['base', 'docs-only']);
  } finally {
    firstWrite.resolve();
    await context.close();
  }
});
