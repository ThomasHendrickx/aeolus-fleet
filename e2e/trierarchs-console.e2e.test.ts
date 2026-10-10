import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createPrismaClient, type PrismaClient } from '../packages/core/src/adapters/prisma/client.js';
import { createApp } from '../packages/core/src/app.js';
import { createUseCases, type UseCases } from '../packages/core/src/wiring.js';
import type { Caller } from '../packages/core/src/domain/shared/caller.js';
import { FLEET_URL, OPERATOR, operatorCaller } from '../packages/core/test/support/core-fixtures.js';
import { newKey } from '../packages/core/test/support/keys.js';
import { createMigratedDatabase } from '../packages/core/test/support/database.js';
import { createTestClock } from '../packages/core/test/support/postgres-core.js';
import { unwrap } from '../packages/core/test/support/result.js';
import { createTrierarchPluginApp, type TrierarchPluginApp } from '../packages/trierarch-plugin/src/app.js';
import { createRestFleet } from '../packages/trierarch/src/adapters/rest-fleet.js';
import { EMPTY_STATE } from '../packages/trierarch/src/core/entry.js';
import { createReportSelf } from '../packages/trierarch/src/core/report-self.js';
import { createPluginDatabase } from '../packages/trierarch-plugin/test/support/database.js';
import { signIn } from './support/console.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';

// The Trierarchs section, end to end (#245): a console with the trierarch
// plugin and without squadrons offers Settings for it; the operator connects
// it there, the web app's server commissions trierarch-plugin and hands its
// secret over, and no secret reaches the browser. Trierarchs then lists no
// machine until the operator joins one, whose setup line shows once.

// The fleet's clock starts at the real time: the trierarch plugin reads a machine's last seen against its own, real clock.
const clock = createTestClock(new Date().toISOString());
/** Sign-ins are rate limited per window; each test signs in after the window of the one before. */
const SIGN_IN_WINDOW_MS = 60_000;
/** How long a poll waits for the page to catch up with the fleet. */
const WITHIN = { timeout: 20_000 };

let database: PrismaClient;
let useCases: UseCases;
let argo: Caller;
let serverUrl: string;
/** The joined machine's setup line, shown once in the second test: the third runs its trierarch. */
let setupLine = '';
/** The joined machine's trierarch, registered in the third test: the fourth reports its machine with it. */
let machine = { shipId: '', crewToken: '' };
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
  argo = operatorCaller(unwrap(await useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR })));

  const webUrl = await reserveWebUrl();
  server = createApp({ databaseUrl, publicUrl: FLEET_URL, consoleOrigin: webUrl, clock, logger: false });
  serverUrl = await server.listen({ host: '127.0.0.1', port: 0 });
  // The plugin reads the machines' last seen, which the server stamps with the test clock: on the same clock, a machine is never silent by real time passing.
  plugin = createTrierarchPluginApp({ databaseUrl: await createPluginDatabase(), fleetUrl: serverUrl, clock, logger: false });
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

/** Whether the fleet holds a lease for the ship of this name: the plugin is connected as it. */
async function isCrewed(name: string): Promise<boolean> {
  const ship = await database.ship.findFirstOrThrow({ where: { name, retiredAt: null } });
  return (await database.lease.count({ where: { shipId: ship.id, endedAt: null } })) === 1;
}

describe('Trierarchs in the console', () => {
  it('connects the trierarch plugin from Settings as trierarch-plugin, which may assign crew requests and label machines, and the browser never gets the secret', async () => {
    const page = await signedIn();
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('settings-trierarchs-state').textContent()).resolves.toContain('Not connected');

    const [answer] = await Promise.all([
      page.waitForResponse((response) => response.request().method() === 'POST' && response.request().headers()['next-action'] !== undefined),
      page.getByTestId('settings-trierarchs-connect').click(),
    ]);

    await page.getByTestId('settings-trierarchs').getByText('Connected as').waitFor();
    expect(await answer.text()).not.toMatch(/aeolus_sk_v1/);
    const ship = await database.ship.findFirstOrThrow({ where: { name: 'trierarch-plugin', retiredAt: null } });
    expect(ship).toMatchObject({ type: 'trierarch-plugin', scopes: ['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage', 'crew:assign', 'labels:define', 'labels:assign'] });
    await expect(isCrewed('trierarch-plugin')).resolves.toBe(true);
  });

  it('lists no machine, then joins one: its setup line shows once, and it is listed as not started', async () => {
    const page = await signedIn();
    await page.getByTestId('nav-trierarchs').click();
    await page.getByText('No machines yet').waitFor();

    await page.getByTestId('trierarchs-join').click();
    await page.getByTestId('join-machine-name').fill('trierarch-mac');
    await page.getByTestId('join-machine-submit').click();

    setupLine = (await page.getByTestId('join-machine-setup-line').textContent()) ?? '';
    expect(setupLine).toContain('npx @aeolus-fleet/trierarch init');
    await page.getByTestId('join-machine-dialog').getByRole('button', { name: 'Done' }).click();
    const card = page.getByTestId('machine-card');
    await card.getByText('trierarch-mac').waitFor();
    await expect(card.getByTestId('machine-liveness').getAttribute('data-liveness')).resolves.toBe('not-started');
    // A trierarch that never ran is not silent: nothing to count yet.
    await expect(page.getByTestId('nav-trierarchs-count').count()).resolves.toBe(0);
  });

  it('requests a crew with settings from the ship page, from what the machine offers, and the plugin assigns its trierarch', async () => {
    // The machine's trierarch, as init and run make it, from the setup line shown once: it registers and reports what it offers.
    const shipId = z.templateLiteral(['shp_', z.string()]).parse(/--ship-id (\S+)/.exec(setupLine)?.[1]);
    const secret = z.string().parse(/--secret (\S+)/.exec(setupLine)?.[1]);
    const { crewToken } = await createRestFleet({ fleetUrl: serverUrl, crewToken: '' }).registerSelf({ shipId, secret });
    machine = { shipId, crewToken };
    await createReportSelf({
      fleet: createRestFleet({ fleetUrl: serverUrl, crewToken }),
      processes: { list: () => Promise.resolve([]), stop: () => Promise.resolve() },
      // Its harness trusts its repository, as init makes it (#381).
      trust: { trusted: () => Promise.resolve({ 'claude-code': { repositories: ['aeolus-fleet'], folders: [] } }) },
      state: { load: () => Promise.resolve(EMPTY_STATE), save: () => Promise.resolve() },
      setup: {
        configuration: { caps: { ships: 2, running: 1 }, repositories: { 'aeolus-fleet': { path: '/srv/aeolus-fleet' } }, folders: {}, harnesses: { 'claude-code': { flags: [], options: {} } } },
        version: '0.19.0',
        adapterFlags: {},
        riskyFlags: {},
      },
    })();
    const scout = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'implementer' }));
    const page = await signedIn();
    await page.goto(`/ships/${scout.shipId}`);

    await page.getByTestId('crew-request-request').click();
    const dialog = page.getByTestId('request-crew-dialog');
    await expect.poll(() => dialog.getByTestId('crew-settings-workspace').textContent()).toContain('aeolus-fleet');
    await dialog.getByTestId('request-crew-submit').click();

    const card = page.getByTestId('crew-request');
    await card.getByTestId('crew-request-settings').getByText('aeolus-fleet').waitFor();
    await card.getByTestId('crew-request-edit').waitFor();
    await plugin.assignOnce();
    await card.getByTestId('crew-request-trierarch').getByText('trierarch-mac').waitFor({ timeout: 30_000 });
    await expect(card.getByTestId('crew-request-trierarch').getAttribute('href')).resolves.toBe(`/trierarchs/${shipId}`);

    // Crewing is not running yet: the request is on Needs crew, and the overview shows where it stands.
    await expect.poll(() => page.getByTestId('nav-needs-crew-count').textContent(), { timeout: 30_000 }).toContain('1');
    await page.getByTestId('nav-needs-crew').click();
    await page.getByTestId('needs-crew-row').getByText('scout').waitFor();
    await page.getByTestId('nav-overview').click();
    await expect.poll(() => page.getByTestId('fleet-row-scout').getByTestId('fleet-crew-request').textContent(), { timeout: 30_000 }).toBe('Crewing');

    // Its machine's page shows the ship with the workspace its settings name, and Trierarchs the plugin's version.
    await page.goto(`/trierarchs/${shipId}`);
    await expect.poll(() => page.getByTestId('machine-spot-workspace').textContent(), { timeout: 30_000 }).toContain('aeolus-fleet');
    await page.goto('/trierarchs');
    await expect.poll(() => page.getByTestId('trierarchs-plugin-version').textContent()).toMatch(/^trierarch plugin \d+\.\d+\.\d+/);
  });

  it('labels the machine from what it reports, and a request for a machine none matches waits and says why (#102)', async () => {
    await createReportSelf({
      fleet: createRestFleet({ fleetUrl: serverUrl, crewToken: machine.crewToken }),
      processes: { list: () => Promise.resolve([]), stop: () => Promise.resolve() },
      // Its harness trusts its repository, as init makes it (#381).
      trust: { trusted: () => Promise.resolve({ 'claude-code': { repositories: ['aeolus-fleet'], folders: [] } }) },
      state: { load: () => Promise.resolve(EMPTY_STATE), save: () => Promise.resolve() },
      setup: {
        configuration: { caps: { ships: 2, running: 1 }, repositories: { 'aeolus-fleet': { path: '/srv/aeolus-fleet' } }, folders: {}, harnesses: { 'claude-code': { flags: [], options: {} } } },
        version: '0.20.0',
        adapterFlags: {},
        riskyFlags: {},
        machine: { os: 'macos', arch: 'arm64' },
      },
    })();
    await plugin.assignOnce();
    const lookout = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'lookout', type: 'implementer' }));
    const page = await signedIn();

    // Its page shows the labels the plugin put on it, read-only.
    await page.goto(`/trierarchs/${machine.shipId}`);
    await expect.poll(() => page.getByTestId('machine-labels-row').textContent(), WITHIN).toContain('os=macos');

    await page.goto(`/ships/${lookout.shipId}`);
    await page.getByRole('banner').getByText('Live', { exact: true }).waitFor(WITHIN);
    await page.getByTestId('crew-request-request').click();
    const dialog = page.getByTestId('request-crew-dialog');
    await dialog.getByTestId('machine-labels-add').click();
    const picker = page.locator('[data-testid="machine-labels-popover"][data-open]');
    await picker.getByTestId('label-picker-key').filter({ hasText: 'os' }).click();
    await picker.getByTestId('label-picker-value').filter({ hasText: 'linux' }).click();
    await expect.poll(() => dialog.getByTestId('machine-labels-match').textContent(), WITHIN).toContain('No machine matches this label');
    await dialog.getByTestId('request-crew-submit').click();

    const card = page.getByTestId('crew-request');
    await expect.poll(() => card.getByTestId('crew-request-machine-labels').textContent(), WITHIN).toContain('os=linux');
    await plugin.assignOnce();
    await expect.poll(() => card.getByTestId('crew-request-note').textContent(), WITHIN).toContain('No machine matches these labels');
  });
});
