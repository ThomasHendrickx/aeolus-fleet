import type { FleetId } from '@aeolus-fleet/common';
import { SCOPES } from '@aeolus-fleet/common';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../packages/core/src/adapters/prisma/client.js';
import { createApp } from '../packages/core/src/app.js';
import type { AppRouter } from '../packages/core/src/index.js';
import { createUseCases } from '../packages/core/src/wiring.js';
import { FLEET_URL, secretOf } from '../packages/core/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../packages/core/src/testing/database.js';
import { newKey } from '../packages/core/src/testing/keys.js';
import { unwrap } from '../packages/core/src/testing/result.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';

// The overview's one bar and sortable headers, end to end (#1605): a
// builder at work, a reviewer waiting and a trierarch's ship idle. The bar
// filters the cards and the list the same, keeps its picks and the view in
// the address, and on the phone moves into a Sheet; a header sorts the list.

const INSTALLATION_TOKEN = 'aeolus_installation_test_0123456789abcdef';

let database: PrismaClient;
let server: FastifyInstance;
let serverUrl: string;
let web: RunningWeb;
let browser: Browser;
const contexts: BrowserContext[] = [];
let fleetId: FleetId;

function installation() {
  return createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${serverUrl}/trpc`, headers: { 'x-aeolus-installation-token': INSTALLATION_TOKEN } })] }).installation;
}

/** builder works, reviewer waits, trierarch-mac has not reported: idle. */
const REPORTS: Partial<Record<string, 'working' | 'blocked'>> = { builder: 'working', reviewer: 'blocked' };

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  const webUrl = await reserveWebUrl();
  server = createApp({ databaseUrl, publicUrl: FLEET_URL, consoleOrigin: webUrl, logger: false, installationToken: INSTALLATION_TOKEN });
  serverUrl = await server.listen({ host: '127.0.0.1', port: 0 });
  web = await startWeb({ url: webUrl, serverUrl });
  browser = await launchChromium();
  const created = await installation().fleets.create.mutate({ requestId: newKey(), name: 'harbour', operatorEmail: 'harbour@example.com' });
  fleetId = created.fleetId;
  const argo = { fleetId, shipId: created.operatorShipId, kind: 'operator' as const, scopes: [...SCOPES] };
  const core = createUseCases({ prisma: database });
  for (const [name, type, harness] of [['builder', 'builder', 'claude-code'], ['reviewer', 'reviewer', 'codex'], ['trierarch-mac', 'trierarch', 'aeolus-trierarch']] as const) {
    const ship = unwrap(await core.commissionShip(argo, { idempotencyKey: newKey(), name, type }));
    const { crewToken } = unwrap(await core.claimShip({ shipId: ship.shipId, secret: secretOf(ship.secret), location: { kind: 'DEVICE' }, harness }));
    const report = REPORTS[name];
    if (report !== undefined) {
      unwrap(await core.report(unwrap(await core.authenticate.byCrewToken(crewToken)), { state: report }));
    }
  }
});

afterAll(async () => {
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
  await web.stop();
  await server.close();
  await database.$disconnect();
});

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

async function signedIn(device: Record<string, unknown> = {}): Promise<Page> {
  const { ticket } = await installation().operators.issueSignInTicket.mutate({ fleetId });
  const context = await browser.newContext({ baseURL: web.url, ...device });
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(`/sign-in/ticket?ticket=${encodeURIComponent(ticket)}`);
  await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
  return page;
}

/** The names on Harbour's tiles, in the order shown. */
async function tileNames(page: Page): Promise<string[]> {
  const texts = await page.getByTestId('harbour').getByTestId('harbour-tile').allInnerTexts();
  return texts.map((text) => text.split('\n')[0] ?? '');
}

async function rowNames(page: Page): Promise<string[]> {
  const rows = await page.getByRole('table', { name: 'Ships' }).locator('tbody tr').all();
  const ids = await Promise.all(rows.map((row) => row.getAttribute('data-testid')));
  return ids.map((id) => (id ?? '').replace('fleet-row-', ''));
}

describe("the overview's bar", () => {
  it('keeps only the reviewers by Type, in the cards and then the list, and keeps the pick and the view in the address', async () => {
    const page = await signedIn();
    await expect.poll(() => tileNames(page)).toEqual(['argo', 'reviewer', 'builder', 'trierarch-mac']);

    await page.getByTestId('fleet-filter-type').click();
    await page.getByTestId('fleet-filter-type-popover').getByRole('button', { name: /reviewer/ }).click();
    await page.waitForURL(/type=reviewer/);
    await page.keyboard.press('Escape');

    await expect.poll(() => tileNames(page)).toEqual(['reviewer']);
    await page.getByTestId('fleet-count').getByText('1 of 4 ships').waitFor();
    await page.getByTestId('fleet-view-list').click();
    await page.waitForURL(/view=list/);
    await expect.poll(() => rowNames(page)).toEqual(['reviewer']);
    await page.reload();
    await expect.poll(() => rowNames(page)).toEqual(['reviewer']);
    await expect(page.getByTestId('fleet-filter-type').textContent()).resolves.toBe('Typereviewer');
  });

  it('keeps only the working and idle ships by State in the list, argo among them, and Clear filters puts every ship back', async () => {
    const page = await signedIn();
    await page.goto('/?view=list');
    await page.getByTestId('fleet-row-reviewer').waitFor();

    await page.getByTestId('fleet-filter-state').click();
    await page.getByRole('option', { name: /Working/ }).click();
    await page.getByRole('option', { name: /Idle/ }).click();
    await page.waitForURL(/state=working&state=idle/);
    await page.keyboard.press('Escape');

    await expect.poll(() => rowNames(page)).toEqual(['argo', 'builder', 'trierarch-mac']);
    await page.getByTestId('fleet-filters-clear').click();
    await expect.poll(() => rowNames(page)).toEqual(['argo', 'builder', 'reviewer', 'trierarch-mac']);
  });

  it('says no ship matches a search that finds none, and Clear search puts every ship back', async () => {
    const page = await signedIn();
    await page.getByTestId('fleet-search').fill('zz');

    await page.getByTestId('fleet-no-match').getByText('No ships match “zz”.').waitFor();
    await page.getByTestId('fleet-clear-filters').click();
    await expect.poll(() => tileNames(page)).toEqual(['argo', 'reviewer', 'builder', 'trierarch-mac']);
  });

  it("keeps only the trierarch's ship by Type from the phone's Sheet, and shows the pick as a chip", async () => {
    const page = await signedIn(PHONE);
    await expect.poll(() => tileNames(page)).toHaveLength(4);

    await page.getByTestId('fleet-filters-open').click();
    await page.getByRole('group', { name: 'Type' }).getByRole('button', { name: 'trierarch' }).click();
    await page.getByTestId('fleet-filters-apply').getByText('Show 1 ship').waitFor();
    await page.getByTestId('fleet-filters-apply').click();

    await page.getByTestId('fleet-filter-chips').getByText('Type: trierarch').waitFor();
    await expect.poll(() => tileNames(page)).toEqual(['trierarch-mac']);
  });
});

describe('sorting by a header', () => {
  it('sorts by ship A to Z, then Z to A, then back to argo first', async () => {
    const page = await signedIn();
    await page.goto('/?view=list');
    await page.getByTestId('fleet-row-trierarch-mac').waitFor();
    const header = page.getByTestId('fleet-sort-ship');

    await header.getByRole('button').click();
    await page.waitForURL(/sort=ship/);
    await expect(header.getAttribute('aria-sort')).resolves.toBe('ascending');
    await expect(rowNames(page)).resolves.toEqual(['argo', 'builder', 'reviewer', 'trierarch-mac']);

    await header.getByRole('button').press('Enter');
    await page.waitForURL(/order=desc/);
    await expect(rowNames(page)).resolves.toEqual(['trierarch-mac', 'reviewer', 'builder', 'argo']);

    await header.getByRole('button').click();
    await expect.poll(() => header.getAttribute('aria-sort')).toBe('none');
    await expect(rowNames(page)).resolves.toEqual(['argo', 'builder', 'reviewer', 'trierarch-mac']);
  });
});
