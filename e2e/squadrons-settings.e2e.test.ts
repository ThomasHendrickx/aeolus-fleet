import { idSchema } from '@aeolus-fleet/common';
import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../packages/core/src/adapters/prisma/client.js';
import { createApp } from '../packages/core/src/app.js';
import type { Caller } from '../packages/core/src/domain/shared/caller.js';
import { createUseCases, type UseCases } from '../packages/core/src/wiring.js';
import { FLEET_URL, OPERATOR, operatorCaller } from '../packages/core/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../packages/core/test/support/database.js';
import { newKey } from '../packages/core/test/support/keys.js';
import { createTestClock } from '../packages/core/test/support/postgres-core.js';
import { unwrap } from '../packages/core/test/support/result.js';
import { createSquadronsApp, type SquadronsApp } from '../packages/squadrons/src/app.js';
import { createSquadronsDatabase } from '../packages/squadrons/test/support/database.js';
import { startFakeGithub, tagsAt, type FakeGithub } from '../packages/squadrons/test/support/fake-github.js';
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
/**
 * The add form clears once the add settles, after the list and the catalogue are read again: the row
 * can show first, and the reads can take longer than expect.poll's one second, so it waits as long as a locator.
 */
const FORM_CLEARS = { timeout: 30_000 };

let database: PrismaClient;
let useCases: UseCases;
let argo: Caller;
let server: FastifyInstance;
let squadrons: SquadronsApp;
let github: FakeGithub;
let squadronsUrl: string;
/** Every call squadrons received, as method and path: the web app's server makes them, never the browser. */
const squadronsReceived: string[] = [];
let web: RunningWeb;
let browser: Browser;
const contexts: BrowserContext[] = [];

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  useCases = createUseCases({ prisma: database, clock });
  argo = operatorCaller(unwrap(await useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR })));

  const webUrl = await reserveWebUrl();
  server = createApp({ databaseUrl, publicUrl: FLEET_URL, consoleOrigin: webUrl, clock, logger: false });
  const serverUrl = await server.listen({ host: '127.0.0.1', port: 0 });
  github = await startFakeGithub();
  squadrons = createSquadronsApp({ databaseUrl: await createSquadronsDatabase(), fleetUrl: serverUrl, githubApiUrl: github.apiUrl, logger: false });
  await squadrons.restoreConnections();
  squadrons.server.addHook('onRequest', (request) => {
    squadronsReceived.push(`${request.method} ${new URL(request.url, 'http://squadrons').pathname}`);
    return Promise.resolve();
  });
  squadronsUrl = await squadrons.server.listen({ host: '127.0.0.1', port: 0 });
  web = await startWeb({ url: webUrl, serverUrl, squadronsUrl });
  browser = await launchChromium();
});

afterAll(async () => {
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
  await web.stop();
  await squadrons.close();
  await github.close();
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

/** Whether the fleet holds a lease for the ship of this name: the plugin is connected as it. */
async function isCrewed(name: string): Promise<boolean> {
  const ship = await database.ship.findFirstOrThrow({ where: { name, retiredAt: null } });
  return (await database.lease.count({ where: { shipId: ship.id, endedAt: null } })) === 1;
}

describe('Settings, Squadrons', () => {
  it("asks squadrons only for its connection while it is configured but not connected, and keeps a ship's plain actions steady", async () => {
    unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'reviewer-02', type: 'reviewer' }));
    clock.advance(SIGN_IN_WINDOW_MS);
    const context = await browser.newContext({ baseURL: web.url });
    contexts.push(context);
    const page = await context.newPage();
    squadronsReceived.length = 0;
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
    expect(new Set(squadronsReceived)).toEqual(new Set(['GET /trpc/connection.status']));
  });

  it('connects squadrons as a new management ship with fleet read and manage, and the browser never gets the secret', async () => {
    const page = await settingsPage();
    await expect(page.getByTestId('settings-squadrons-state').textContent()).resolves.toContain('Not connected');

    const [answer] = await Promise.all([
      page.waitForResponse((response) => response.request().method() === 'POST' && response.request().headers()['next-action'] !== undefined),
      page.getByTestId('settings-squadrons-connect').click(),
    ]);

    await page.getByText('Connected as').waitFor();
    expect(await answer.text()).not.toMatch(/aeolus_sk_v1|Ship secret/);
    const ship = await database.ship.findFirstOrThrow({ where: { name: 'squadrons', retiredAt: null } });
    expect(ship).toMatchObject({ type: 'squadrons', scopes: ['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage'] });
    await expect(isCrewed('squadrons')).resolves.toBe(true);
  });

  it('connects the same ship again once the operator released it', async () => {
    const ship = await database.ship.findFirstOrThrow({ where: { name: 'squadrons', retiredAt: null } });
    unwrap(await useCases.releaseShip(argo, { shipId: idSchema('ship').parse(ship.id) }));
    const page = await settingsPage();
    await page.getByText('Not connected').waitFor();

    await page.getByTestId('settings-squadrons-connect').click();

    await page.getByText('Connected as').waitFor();
    await expect(database.ship.count({ where: { name: 'squadrons' } })).resolves.toBe(1);
    await expect(isCrewed('squadrons')).resolves.toBe(true);
  });

  it('adds a repository that cannot be fetched: it is kept with why, and removing it after a confirm takes it out', async () => {
    const page = await settingsPage();
    const repositories = page.getByTestId('settings-repositories');
    await repositories.getByText('No repositories yet').waitFor();

    // GitHub has no such repository: the fetch fails, and squadrons keeps the repository with why.
    await page.getByTestId('repositories-url').fill('https://github.com/acme/missing.git');
    await page.getByTestId('repositories-add-submit').click();

    const row = repositories.getByTestId('repositories-row');
    await row.getByText('acme/missing', { exact: true }).waitFor();
    await row.getByTestId('repositories-error').waitFor();
    await expect.poll(() => page.getByTestId('repositories-url').inputValue(), FORM_CLEARS).toBe('');

    await row.getByTestId('repositories-remove').click();
    await page.getByTestId('repositories-remove-dialog').getByText('Remove github.com/acme/missing?').waitFor();
    await page.getByTestId('repositories-remove-confirm').click();

    await repositories.getByText('No repositories yet').waitFor();
  });

  it('shows per repository what squadrons found, and every file and tag it left out with why; a repository read whole shows nothing left out', async () => {
    const tester = 'description: Tests.\ncheckIn: 30m\ncharter: You test.\n';
    github.repositories.set('acme/whole', { tags: tagsAt({ files: { '.aeolus/squadrons/templates/tester.yaml': tester } }, 'tester@1') });
    github.repositories.set('acme/mixed', {
      tags: tagsAt(
        {
          files: {
            '.aeolus/squadrons/templates/tester.yaml': tester,
            '.aeolus/squadrons/templates/planner.yaml': 'description: Plans.\ncheckIn: often\ncharter: You plan.\n',
            '.aeolus/squadrons/blueprints/team.yaml': 'description: A team.\nroles:\n  tester:\n    template: github.com/Acme/mixed#tester@1\n',
          },
        },
        'tester@1', 'planner@1', 'team@1', 'reviewer@1', 'v1.0.0',
      ),
    });
    const page = await settingsPage();
    const repositories = page.getByTestId('settings-repositories');

    for (const url of ['https://github.com/acme/whole.git', 'https://github.com/acme/mixed.git']) {
      await page.getByTestId('repositories-url').fill(url);
      await page.getByTestId('repositories-add-submit').click();
      await expect.poll(() => page.getByTestId('repositories-url').inputValue(), FORM_CLEARS).toBe('');
    }

    const whole = repositories.getByTestId('repositories-row').filter({ hasText: 'acme/whole' });
    const mixed = repositories.getByTestId('repositories-row').filter({ hasText: 'acme/mixed' });
    await mixed.getByTestId('repositories-left-out').waitFor();
    await expect(whole.getByTestId('repositories-found').textContent()).resolves.toBe('Templatestester@1BlueprintsNone');
    await expect(whole.getByTestId('repositories-left-out').count()).resolves.toBe(0);
    await expect(mixed.getByTestId('repositories-found').textContent()).resolves.toBe('Templatestester@1BlueprintsNone');
    await expect(mixed.getByTestId('repositories-left-out-item').allTextContents()).resolves.toEqual([
      'tag reviewer@1: the tag reviewer@1 points at a commit with neither .aeolus/squadrons/templates/reviewer.yaml nor .aeolus/squadrons/blueprints/reviewer.yaml',
      'template planner@1: checkIn must be a duration such as 30m or 2h',
      'blueprint team v1: roles.tester.template: squadrons knows no repository github.com/Acme/mixed; it knows github.com/acme/mixed, and a reference must match its name exactly, letter case too',
    ]);
  });
});
