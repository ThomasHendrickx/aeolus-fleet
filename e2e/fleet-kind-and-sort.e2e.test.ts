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

// The overview's Kind filter and sortable headers, end to end: a ship crewed
// from Claude Code, one from Codex and a trierarch's; the filter keeps one
// kind or several (#815), on desktop and in the phone's Sheet, and a header
// sorts the rows.

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
    unwrap(await core.claimShip({ shipId: ship.shipId, secret: secretOf(ship.secret), location: { kind: 'DEVICE' }, harness }));
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

async function rowNames(page: Page): Promise<string[]> {
  const rows = await page.getByRole('table', { name: 'Ships' }).locator('tbody tr').all();
  const ids = await Promise.all(rows.map((row) => row.getAttribute('data-testid')));
  return ids.map((id) => (id ?? '').replace('fleet-row-', ''));
}

describe('the Kind filter', () => {
  it('keeps only the ships crewed from Codex, and keeps the choice in the URL', async () => {
    const page = await signedIn();
    await page.getByTestId('fleet-row-reviewer').waitFor();

    await page.getByTestId('fleet-filter-kind').click();
    await page.getByRole('option', { name: 'Codex' }).click();
    await page.waitForURL(/kind=codex/);

    await expect(rowNames(page)).resolves.toEqual(['reviewer']);
  });

  it('keeps the ships crewed from Claude Code or Codex when both are picked, and keeps both in the URL', async () => {
    const page = await signedIn();
    await page.getByTestId('fleet-row-trierarch-mac').waitFor();

    await page.getByTestId('fleet-filter-kind').click();
    await page.getByRole('option', { name: 'Claude Code' }).click();
    await page.getByRole('option', { name: 'Codex' }).click();
    await page.waitForURL(/kind=claudeCode&kind=codex/);
    await page.keyboard.press('Escape');

    await expect(rowNames(page)).resolves.toEqual(['builder', 'reviewer']);
    await page.reload();
    await page.getByTestId('fleet-row-builder').waitFor();
    await expect(rowNames(page)).resolves.toEqual(['builder', 'reviewer']);
    await expect(page.getByTestId('fleet-filter-kind').textContent()).resolves.toBe('Kind2 picked');
  });

  it('keeps only the trierarchs from the phone Sheet', async () => {
    const page = await signedIn(PHONE);
    await page.getByTestId('fleet-card-builder').waitFor();

    await page.getByTestId('fleet-filters-open').click();
    await page.getByRole('group', { name: 'Kind' }).getByRole('button', { name: 'Trierarch' }).click();
    await page.getByTestId('fleet-filters-apply').click();
    await page.getByTestId('fleet-filter-chips').getByText('Kind: Trierarch').waitFor();

    await expect(page.getByRole('list', { name: 'Ships' }).getByRole('listitem').count()).resolves.toBe(1);
  });

  it('keeps the ships crewed from Claude Code or Codex when both are picked in the phone Sheet', async () => {
    const page = await signedIn(PHONE);
    await page.getByTestId('fleet-card-builder').waitFor();

    await page.getByTestId('fleet-filters-open').click();
    const kinds = page.getByRole('group', { name: 'Kind' });
    await kinds.getByRole('button', { name: 'Claude Code' }).click();
    await kinds.getByRole('button', { name: 'Codex' }).click();
    await page.getByTestId('fleet-filters-apply').click();
    await page.getByTestId('fleet-filter-chips').getByText('Kind: Claude Code, Codex').waitFor();

    await expect(page.getByRole('list', { name: 'Ships' }).getByRole('listitem').count()).resolves.toBe(2);
  });
});

describe('sorting by a header', () => {
  it('sorts by ship A to Z, then Z to A, then back to argo first', async () => {
    const page = await signedIn();
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
