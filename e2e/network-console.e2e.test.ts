import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { LabelValueId } from '../packages/common/src/index.js';
import { createPrismaClient, type PrismaClient } from '../packages/core/src/adapters/prisma/client.js';
import { createApp } from '../packages/core/src/app.js';
import type { Caller } from '../packages/core/src/domain/shared/caller.js';
import { createUseCases, type UseCases } from '../packages/core/src/wiring.js';
import { FLEET_URL, OPERATOR, operatorCaller } from '../packages/core/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../packages/core/test/support/database.js';
import { createTestClock } from '../packages/core/test/support/postgres-core.js';
import { unwrap } from '../packages/core/test/support/result.js';
import { createNetworkingPluginApp, type NetworkingPluginApp } from '../packages/networking-plugin/src/app.js';
import { createPluginDatabase } from '../packages/networking-plugin/test/support/database.js';
import { signIn } from './support/console.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';

// The networking plugin in the console, end to end (#260, S2b-2): argo
// connects it from Settings, the web app's server commissions
// networking-plugin and hands its secret over, and no secret reaches the
// browser. Network then shows the fleet all-to-all; argo sets a rule from
// label values, the plugin supplies it, and the fleet holds it. Argo changes
// what the plugin declares for while it is unavailable, and turning rules
// off, once confirmed, leaves the fleet all-to-all again.

const clock = createTestClock(new Date().toISOString());
/** Sign-ins are rate limited per window; each test signs in after the window of the one before. */
const SIGN_IN_WINDOW_MS = 60_000;
/** How long a poll waits for the page or the fleet to catch up. */
const WITHIN = { timeout: 20_000 };

let database: PrismaClient;
let useCases: UseCases;
let argo: Caller;
let server: FastifyInstance;
let plugin: NetworkingPluginApp;
let web: RunningWeb;
let browser: Browser;
const contexts: BrowserContext[] = [];
/** The value ids of argo's labels, by `key=value`. */
const valueIds = new Map<string, LabelValueId>();

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  useCases = createUseCases({ prisma: database, clock });
  argo = operatorCaller(unwrap(await useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR })));
  for (const [key, values] of [
    ['team', ['ops', 'research']],
    ['tier', ['sensitive']],
  ] as const) {
    const defined = unwrap(await useCases.defineLabel(argo, { key, values: [...values] }));
    for (const value of defined.values) {
      valueIds.set(`${key}=${value.value}`, value.id);
    }
  }

  const webUrl = await reserveWebUrl();
  server = createApp({ databaseUrl, publicUrl: FLEET_URL, consoleOrigin: webUrl, clock, logger: false });
  const serverUrl = await server.listen({ host: '127.0.0.1', port: 0 });
  plugin = createNetworkingPluginApp({ databaseUrl: await createPluginDatabase(), fleetUrl: serverUrl, clock, logger: false });
  await plugin.restoreConnections();
  const pluginUrl = await plugin.server.listen({ host: '127.0.0.1', port: 0 });
  web = await startWeb({ url: webUrl, serverUrl, networkingPluginUrl: pluginUrl });
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

/** A phone: below the sm breakpoint, where the TopBar Avatar opens the account sheet. */
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

async function signedIn(options: { isPhone: boolean } = { isPhone: false }): Promise<Page> {
  clock.advance(SIGN_IN_WINDOW_MS);
  const context = await browser.newContext({ baseURL: web.url, ...(options.isPhone ? PHONE : {}) });
  contexts.push(context);
  const page = await context.newPage();
  await signIn(page, OPERATOR);
  await page.waitForURL(`${web.url}/`);
  return page;
}

/** The fleet's network settings as it stores them. */
function settings() {
  return database.networkSettings.findFirstOrThrow({ where: { fleetId: argo.fleetId } });
}

/** Picks one label value for a side of the rule shown, in its Add label popover. */
async function pick(page: Page, at: { side: 'from' | 'to'; key: string; value: string }): Promise<void> {
  const { side, key, value } = at;
  await page.getByTestId('network-rule').getByTestId(`network-rule-${side}-add`).click();
  const picker = page.locator('[data-testid="network-rule-popover"][data-open]');
  await picker.getByTestId('label-picker-key').filter({ hasText: key }).click();
  await picker.getByTestId('label-picker-value').filter({ hasText: value }).click();
}

describe('the networking plugin in the console', () => {
  it('connects the networking plugin from Settings as networking-plugin, which may read the fleet and set its rules, and the browser never gets the secret', async () => {
    const page = await signedIn();
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('settings-network-state').textContent()).resolves.toContain('Not connected');
    // Not connected, Network is not offered yet.
    await expect(page.getByTestId('nav-network').count()).resolves.toBe(0);

    const [answer] = await Promise.all([
      page.waitForResponse((response) => response.request().method() === 'POST' && response.request().headers()['next-action'] !== undefined),
      page.getByTestId('settings-network-connect').click(),
    ]);

    await page.getByTestId('settings-network').getByText('Connected as').waitFor();
    expect(await answer.text()).not.toMatch(/aeolus_sk_v1/);
    const ship = await database.ship.findFirstOrThrow({ where: { name: 'networking-plugin', retiredAt: null } });
    expect(ship).toMatchObject({ type: 'networking-plugin', scopes: ['messages:send', 'messages:receive', 'fleet:read', 'fleet:network'] });
    await expect.poll(async () => (await settings()).pluginShipId, WITHIN).toBe(ship.id);
    await page.getByTestId('nav-network').waitFor();
  });

  it('sets a rule from label values, which the plugin supplies to the fleet', async () => {
    const page = await signedIn();
    await page.getByTestId('nav-network').click();
    await expect.poll(() => page.getByTestId('network-rules-state').textContent(), WITHIN).toContain('every ship may message every ship');

    await page.getByTestId('network-rules-on').click();
    await page.getByTestId('network-rules-add').click();
    await pick(page, { side: 'from', key: 'team', value: 'ops' });
    await pick(page, { side: 'to', key: 'tier', value: 'sensitive' });
    await page.getByTestId('network-rules-save').click();

    await expect.poll(() => page.getByTestId('network-rules-note').textContent(), WITHIN).toContain('Saved');
    await expect.poll(async () => (await settings()).rules, WITHIN).toEqual([{ from: [valueIds.get('team=ops')], to: [valueIds.get('tier=sensitive')] }]);
  });

  it('changes what the plugin declares for while it is unavailable, and the plugin registers again with it', async () => {
    const page = await signedIn();
    await page.getByTestId('nav-network').click();
    const declaration = page.getByTestId('network-declaration');
    await expect.poll(() => declaration.getByTestId('network-declaration-seconds').inputValue(), WITHIN).toBe('300');

    await declaration.getByTestId('network-declaration-while').click();
    await page.getByRole('option', { name: /Block all/ }).click();
    await declaration.getByTestId('network-declaration-seconds').fill('120');
    await declaration.getByTestId('network-declaration-save').click();

    await expect.poll(() => declaration.getByTestId('network-declaration-note').textContent(), WITHIN).toContain('Saved');
    await expect.poll(async () => {
      const { pluginWhileUnavailable, pluginNotRespondingAfterSeconds } = await settings();
      return { pluginWhileUnavailable, pluginNotRespondingAfterSeconds };
    }, WITHIN).toEqual({ pluginWhileUnavailable: 'block-all', pluginNotRespondingAfterSeconds: 120 });
  });

  it('turns rules off once confirmed, and the fleet is all-to-all again', async () => {
    const page = await signedIn();
    await page.getByTestId('nav-network').click();
    await page.getByTestId('network-rule').getByText('team=ops').waitFor(WITHIN);

    await page.getByTestId('network-rules-off').click();
    await page.getByTestId('network-rules-off-confirm').click();

    await expect.poll(() => page.getByTestId('network-rules-state').textContent(), WITHIN).toContain('every ship may message every ship');
    await expect.poll(async () => (await settings()).rules, WITHIN).toBeNull();
  });

  it('on a phone without the trierarch plugin, reaches Settings and, while the plugin is connected, Network from the account sheet', async () => {
    const page = await signedIn({ isPhone: true });
    const sheet = page.getByTestId('account-sheet');

    await page.locator('[data-testid="account-menu"]:visible').click();
    await sheet.getByTestId('account-settings').click();
    await page.getByRole('heading', { name: 'Settings' }).waitFor();
    await page.getByTestId('settings-network').getByText('Connected as').waitFor(WITHIN);

    await page.locator('[data-testid="account-menu"]:visible').click();
    await sheet.getByTestId('account-network').click();
    await page.getByRole('heading', { name: 'Network' }).waitFor();
    await page.getByTestId('network-rules-state').waitFor(WITHIN);
  });
});
