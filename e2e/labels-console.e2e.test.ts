import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { LabelValueId, ShipId } from '../packages/common/src/index.js';

import { createPrismaClient, type PrismaClient } from '../packages/core/src/adapters/prisma/client.js';
import { createApp } from '../packages/core/src/app.js';
import type { Caller } from '../packages/core/src/domain/shared/caller.js';
import { createUseCases, type UseCases } from '../packages/core/src/wiring.js';
import { FLEET_URL, OPERATOR, operatorCaller } from '../packages/core/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../packages/core/test/support/database.js';
import { newKey } from '../packages/core/test/support/keys.js';
import { createTestClock } from '../packages/core/test/support/postgres-core.js';
import { unwrap } from '../packages/core/test/support/result.js';
import { signIn } from './support/console.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';

// Labels in the console (#102, L2a), end to end: argo's labels show on the
// overview's rows and on a ship's page, the label filter keeps the ships that
// carry every value picked and keeps them in the URL, and a label assigned
// meanwhile shows without a reload.

const clock = createTestClock('2026-10-07T12:00:00.000Z');
/** A live change, or the page after the URL changed, shows within this. */
const LIVE_TIMEOUT_MS = 20_000;
const WITHIN = { timeout: LIVE_TIMEOUT_MS };

let database: PrismaClient;
let useCases: UseCases;
let argo: Caller;
let server: FastifyInstance;
let web: RunningWeb;
let browser: Browser;
const contexts: BrowserContext[] = [];
/** The value ids of argo's labels, by `key=value`. */
const valueIds = new Map<string, LabelValueId>();
const shipIds = new Map<string, ShipId>();
/** Sign-ins are rate limited per window; each test signs in after the window of the one before. */
const SIGN_IN_WINDOW_MS = 60_000;

async function define(key: string, values: string[]): Promise<void> {
  const defined = unwrap(await useCases.defineLabel(argo, { key, values }));
  for (const value of defined.values) {
    valueIds.set(`${key}=${value.value}`, value.id);
  }
}

async function commission(name: string, labels: string[]): Promise<void> {
  const { shipId } = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name, type: 'implementer' }));
  shipIds.set(name, shipId);
  for (const label of labels) {
    unwrap(await useCases.assignLabel(argo, { shipId, valueId: idOf(label) }));
  }
}

function idOf(label: string): LabelValueId {
  const id = valueIds.get(label);
  if (id === undefined) {
    throw new RangeError(`no label value ${label}`);
  }
  return id;
}

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  useCases = createUseCases({ prisma: database, clock });
  argo = operatorCaller(unwrap(await useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR })));
  await define('project', ['aeolus', 'hemma']);
  await define('area', ['backend', 'frontend']);
  await commission('hemma-api', ['project=hemma', 'area=backend']);
  await commission('hemma-web', ['project=hemma']);
  await commission('aeolus-core', ['project=aeolus', 'area=backend']);

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

function shipIdOf(name: string): ShipId {
  const id = shipIds.get(name);
  if (id === undefined) {
    throw new RangeError(`no ship ${name}`);
  }
  return id;
}

async function signedIn(): Promise<Page> {
  clock.advance(SIGN_IN_WINDOW_MS);
  const context = await browser.newContext({ baseURL: web.url, viewport: { width: 1440, height: 900 } });
  contexts.push(context);
  const page = await context.newPage();
  await signIn(page, OPERATOR);
  await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
  // Live shows once the page is hydrated and subscribed: a click before that does nothing.
  await page.getByRole('banner').getByText('Live', { exact: true }).waitFor(WITHIN);
  return page;
}

/** The ships the overview lists, argo aside, by name. */
async function listed(page: Page): Promise<string[]> {
  const rows = await page.locator('[data-testid^="fleet-row-"]').all();
  const names = await Promise.all(rows.map(async (row) => ((await row.getAttribute('data-testid')) ?? '').replace('fleet-row-', '')));
  return names.filter((name) => name !== 'argo');
}

/** Picks a value in the open label picker; the URL then carries it. */
async function pick(page: Page, label: { key: string; value: string }): Promise<void> {
  const popover = page.getByTestId('label-filter-popover');
  await popover.waitFor();
  await popover.getByTestId('label-picker-key').filter({ hasText: label.key }).click();
  await popover.getByTestId('label-picker-value').filter({ hasText: label.value }).click();
  await expect.poll(() => new URL(page.url()).searchParams.getAll('label'), WITHIN).toContain(idOf(`${label.key}=${label.value}`));
}

describe('Labels in the console', () => {
  it('shows each ship’s labels on its row, filters by every value picked, and keeps the filter in the URL', async () => {
    const page = await signedIn();
    // Yours by key: area first; project=hemma folds into "+1", whose title names it.
    await expect.poll(() => page.getByTestId('fleet-row-hemma-api').getByTestId('fleet-labels').textContent(), WITHIN).toContain('area=backend');
    await expect(page.getByTestId('fleet-row-hemma-api').getByTitle('project=hemma').count()).resolves.toBe(1);

    await page.getByTestId('fleet-filter-labels').click();
    await pick(page, { key: 'project', value: 'hemma' });
    await expect.poll(() => listed(page), WITHIN).toEqual(['hemma-api', 'hemma-web']);

    await page.getByTestId('fleet-picked-labels').getByRole('button', { name: 'Add' }).click();
    await pick(page, { key: 'area', value: 'backend' });
    await expect.poll(() => listed(page), WITHIN).toEqual(['hemma-api']);
    expect(new URL(page.url()).searchParams.getAll('label')).toEqual([idOf('project=hemma'), idOf('area=backend')]);

    await page.reload();
    await expect.poll(() => listed(page), WITHIN).toEqual(['hemma-api']);
    await page.getByRole('button', { name: 'Remove area=backend' }).click();
    await expect.poll(() => listed(page), WITHIN).toEqual(['hemma-api', 'hemma-web']);
  });

  it('shows a label assigned meanwhile without a reload, and a ship’s labels on its page', async () => {
    const page = await signedIn();
    await page.getByTestId('fleet-row-hemma-web').waitFor();

    unwrap(await useCases.assignLabel(argo, { shipId: shipIdOf('hemma-web'), valueId: idOf('area=frontend') }));
    await expect.poll(() => page.getByTestId('fleet-row-hemma-web').getByTestId('fleet-labels').textContent(), WITHIN).toContain('area=frontend');

    await page.goto(`/ships/${shipIdOf('hemma-api')}`);
    await expect.poll(() => page.getByTestId('ship-labels').textContent(), WITHIN).toContain('area=backend');
    await expect(page.getByTestId('ship-labels').textContent()).resolves.toContain('project=hemma');
  });

  it('defines a label on the Labels page, changes its values at once, refuses removing a value ships carry, and deletes a label no ship carries', async () => {
    const page = await signedIn();
    await page.getByTestId('overview-labels').click();
    await page.getByRole('heading', { name: 'Labels', exact: true }).waitFor();

    await page.getByTestId('labels-define').click();
    const define = page.getByTestId('define-label-dialog');
    await define.getByTestId('define-label-key').fill('site');
    for (const value of ['home', 'office']) {
      await define.getByTestId('define-label-value-input').fill(value);
      await define.getByTestId('define-label-value-input').press('Enter');
    }
    await define.getByTestId('define-label-submit').click();
    await define.waitFor({ state: 'hidden' });
    await expect.poll(() => page.getByTestId('labels-row-site').textContent(), WITHIN).toContain('office');

    await page.getByTestId('labels-row-site').getByTestId('labels-row-menu').click();
    await page.getByTestId('labels-change-values').click();
    const values = page.getByTestId('label-values-dialog');
    await values.getByTestId('label-values-new').fill('lab');
    await values.getByTestId('label-values-add').click();
    await expect.poll(() => values.getByTestId('label-values').textContent(), WITHIN).toContain('lab');
    await values.getByRole('button', { name: 'Remove value home' }).click();
    await expect.poll(() => values.getByTestId('label-values').textContent(), WITHIN).not.toContain('home');
    await values.getByRole('button', { name: 'Close' }).click();

    await page.getByTestId('labels-row-project').getByTestId('labels-row-menu').click();
    await page.getByTestId('labels-change-values').click();
    await values.getByRole('button', { name: 'Remove value hemma' }).click();
    await expect.poll(() => values.textContent(), WITHIN).toContain('Couldn’t remove hemma');
    await expect(values.textContent()).resolves.toContain('hemma-api');
    await values.getByRole('button', { name: 'Close' }).click();

    await page.getByTestId('labels-row-site').getByTestId('labels-row-menu').click();
    await page.getByTestId('labels-delete').click();
    await page.getByTestId('delete-label-confirm').click();
    await expect.poll(() => page.getByTestId('labels-row-site').count(), WITHIN).toBe(0);
  });
});
