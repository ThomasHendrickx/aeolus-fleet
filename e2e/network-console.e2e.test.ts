import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { LabelValueId } from '../packages/common/src/index.js';
import { createPrismaClient, type PrismaClient } from '../packages/core/src/adapters/prisma/client.js';
import { createApp } from '../packages/core/src/app.js';
import type { ShipCaller } from '../packages/core/src/domain/shared/caller.js';
import { createUseCases, type UseCases } from '../packages/core/src/wiring.js';
import { FLEET_URL, OPERATOR, operatorCaller } from '../packages/core/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../packages/core/src/testing/database.js';
import { newKey } from '../packages/core/src/testing/keys.js';
import { createTestClock } from '../packages/core/test/support/postgres-core.js';
import { unwrap } from '../packages/core/src/testing/result.js';
import { signIn } from './support/console.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';
import { withOperatorLogin } from '../packages/core/test/support/operator-login.js';

// The fleet's network rules on Network, end to end (decision 0035): argo
// drafts a rule from label values, sees what the draft changes while nothing
// changes in force, and applies it, which turns open off. With a draft
// saved, the fleet graph shows a picked ship's reach against the applied
// rules or the draft, and discarding the draft leaves the applied rules as
// they are.

const clock = createTestClock(new Date().toISOString());
/** Sign-ins are rate limited per window; each test signs in after the window of the one before. */
const SIGN_IN_WINDOW_MS = 60_000;
/** How long a poll waits for the page or the fleet to catch up. */
const WITHIN = { timeout: 20_000 };

let database: PrismaClient;
let useCases: UseCases;
let argo: ShipCaller;
let server: FastifyInstance;
let web: RunningWeb;
let browser: Browser;
const contexts: BrowserContext[] = [];
/** The value ids of argo's labels, by `key=value`. */
const valueIds = new Map<string, LabelValueId>();

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  useCases = createUseCases({ prisma: database, clock });
  argo = operatorCaller(unwrap(await withOperatorLogin(database, useCases.initialiseFleet({ name: 'home fleet' }))));
  for (const [key, values] of [
    ['team', ['ops']],
    ['tier', ['sensitive']],
  ] as const) {
    const defined = unwrap(await useCases.defineLabel(argo, { key, values: [...values] }));
    for (const value of defined.values) {
      valueIds.set(`${key}=${value.value}`, value.id);
    }
  }
  for (const [name, value] of [
    ['ops-agent', 'team=ops'],
    ['vault', 'tier=sensitive'],
    ['scout', undefined],
  ] as const) {
    const { shipId } = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name, type: 'agent' }));
    const valueId = value === undefined ? undefined : valueIds.get(value);
    if (valueId !== undefined) {
      unwrap(await useCases.assignLabel(argo, { shipId, valueId }));
    }
  }

  const webUrl = await reserveWebUrl();
  server = createApp({ databaseUrl, publicUrl: FLEET_URL, consoleOrigin: webUrl, clock, logger: false });
  const serverUrl = await server.listen({ host: '127.0.0.1', port: 0 });
  web = await startWeb({ url: webUrl, serverUrl });
  browser = await launchChromium();
});

afterAll(async () => {
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
  await web.stop();
  await server.close();
  await database.$disconnect();
});

async function onNetwork(): Promise<Page> {
  clock.advance(SIGN_IN_WINDOW_MS);
  const context = await browser.newContext({ baseURL: web.url });
  contexts.push(context);
  const page = await context.newPage();
  await signIn(page, OPERATOR);
  await page.waitForURL(`${web.url}/`);
  await page.getByTestId('nav-network').click();
  return page;
}

/** The fleet's applied rules as it stores them; none for all-to-all. */
async function appliedRules(): Promise<unknown> {
  return (await database.networkSettings.findFirst({ where: { fleetId: argo.fleetId } }))?.rules ?? null;
}

function draftCount(): Promise<number> {
  return database.networkRulesDraft.count({ where: { fleetId: argo.fleetId } });
}

/** Picks one label value for a side of the last rule, in its Add label popover. */
async function pick(page: Page, at: { side: 'from' | 'to'; key: string; value: string }): Promise<void> {
  await page.getByTestId('network-rule').last().getByTestId(`network-rule-${at.side}-add`).click();
  const picker = page.locator('[data-testid="network-rule-popover"][data-open]');
  await picker.getByTestId('label-picker-key').filter({ hasText: at.key }).click();
  await picker.getByTestId('label-picker-value').filter({ hasText: at.value }).click();
}

describe('the network rules on Network', () => {
  it('drafts a rule from label values, shows what the draft changes while nothing changes in force, and applies it, turning open off', async () => {
    const page = await onNetwork();
    await expect.poll(() => page.getByTestId('network-rules-state').textContent(), WITHIN).toContain('every ship may send to, read and manage every ship');

    await page.getByTestId('network-rules-on').click();
    await page.getByTestId('network-rules-add').click();
    await pick(page, { side: 'from', key: 'team', value: 'ops' });
    await pick(page, { side: 'to', key: 'tier', value: 'sensitive' });
    await page.getByTestId('network-rules-save').click();

    await expect.poll(() => page.getByTestId('network-draft-lost').count(), WITHIN).toBeGreaterThan(0);
    await expect(page.getByTestId('network-draft-lost').filter({ hasText: 'scout' }).first().textContent()).resolves.toContain('Built-in: Open');
    expect([await appliedRules(), await draftCount()]).toEqual([null, 1]);

    await page.getByTestId('network-rules-apply-open').click();
    await page.getByTestId('network-rules-apply-confirm').click();

    const rule = { verb: 'send', from: [valueIds.get('team=ops')], to: [valueIds.get('tier=sensitive')] };
    await expect.poll(appliedRules, WITHIN).toEqual([rule]);
    await expect.poll(draftCount, WITHIN).toBe(0);
    const open = page.getByTestId('network-built-in-rule').filter({ has: page.getByTestId('network-built-in-rule-name').getByText('Open', { exact: true }) });
    await expect.poll(() => open.getByTestId('network-built-in-rule-state').textContent(), WITHIN).toBe('Off');
  });

  it('shows a picked ship’s reach against the applied rules or the draft, and discarding the draft leaves the applied rules as they are', async () => {
    const before = await appliedRules();
    unwrap(await useCases.saveNetworkRulesDraft(argo, { rules: [] }));
    const page = await onNetwork();
    const reach = page.getByTestId('network-reach');

    // Any ship is picked by its name: the graph draws only the ships the page names, the picked ship and its reach.
    await reach.getByTestId('network-reach-search').fill('ops');
    await page.getByRole('option', { name: /ops-agent/ }).click();
    await expect.poll(() => reach.getByTestId('network-reach-summary').textContent(), WITHIN).toBe('ops-agent may message 2 of 3 ships: argo, vault.');
    await reach.getByTestId('network-reach-draft').click();
    await expect.poll(() => reach.getByTestId('network-reach-summary').textContent(), WITHIN).toBe('ops-agent may message 1 of 3 ships: argo.');
    expect(page.url()).toContain('against=draft');

    await page.getByTestId('network-rules-discard-open').click();
    await page.getByTestId('network-rules-discard-confirm').click();

    await expect.poll(draftCount, WITHIN).toBe(0);
    await expect(appliedRules()).resolves.toEqual(before);
    await expect.poll(() => reach.getByTestId('network-reach-draft').count(), WITHIN).toBe(0);
  });
});
