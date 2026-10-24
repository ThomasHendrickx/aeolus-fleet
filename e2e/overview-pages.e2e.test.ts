import type { FleetId } from '@aeolus-fleet/common';
import { SCOPES } from '@aeolus-fleet/common';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createPrismaClient, type PrismaClient } from '../packages/core/src/adapters/prisma/client.js';
import { createApp } from '../packages/core/src/app.js';
import type { AppRouter } from '../packages/core/src/index.js';
import { createUseCases } from '../packages/core/src/wiring.js';
import { FLEET_URL } from '../packages/core/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../packages/core/src/testing/database.js';
import { newKey } from '../packages/core/src/testing/keys.js';
import { unwrap } from '../packages/core/src/testing/result.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';

// The overview pages its ships, end to end (decision 4 of the performance
// design): a fleet of more ships than a page opens on its first 20, asked of
// the server once, and Load more, the search and a sort each ask the server
// for what they show.

const INSTALLATION_TOKEN = 'aeolus_installation_test_0123456789abcdef';
/** More ships than two pages of 20. */
const SHIPS = 45;
const PAGE_SIZE = 20;

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

/** Ship number i of the fleet, by name. */
function shipName(i: number): string {
  return `ship-${String(i).padStart(2, '0')}`;
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
  for (let i = 1; i <= SHIPS; i += 1) {
    unwrap(await core.commissionShip(argo, { idempotencyKey: newKey(), name: shipName(i), type: i % 2 === 0 ? 'builder' : 'reviewer' }));
  }
});

afterAll(async () => {
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
  await web.stop();
  await server.close();
  await database.$disconnect();
});

/** A batched tRPC request's inputs, by the index of each call in the batch. */
const batchInputSchema = z.record(z.string(), z.record(z.string(), z.unknown()));

/** What the browser asked of fleet.list, each call's input, as the batched tRPC requests carry them. */
function fleetListAsked(page: Page): Record<string, unknown>[] {
  const asked: Record<string, unknown>[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    const procedures = url.pathname.replace(/^\/trpc\//, '').split(',');
    if (!url.pathname.startsWith('/trpc/') || !procedures.includes('fleet.list')) {
      return;
    }
    const inputs = new Map(Object.entries(batchInputSchema.parse(JSON.parse(url.searchParams.get('input') ?? '{}'))));
    procedures.forEach((procedure, index) => {
      if (procedure === 'fleet.list') {
        asked.push(inputs.get(String(index)) ?? {});
      }
    });
  });
  return asked;
}

/** The overview's pages asked: the fleet.list calls of 20, not the whole-fleet reads other parts still make. */
function overviewPagesOf(asked: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  return asked.filter((input) => input.limit === PAGE_SIZE);
}

async function signedIn(): Promise<{ page: Page; asked: Record<string, unknown>[] }> {
  const { ticket } = await installation().operators.issueSignInTicket.mutate({ fleetId });
  const context = await browser.newContext({ baseURL: web.url });
  contexts.push(context);
  const page = await context.newPage();
  const asked = fleetListAsked(page);
  await page.goto(`/sign-in/ticket?ticket=${encodeURIComponent(ticket)}`);
  await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
  await page.getByTestId('fleet-row-argo').waitFor();
  return { page, asked };
}

async function rowNames(page: Page): Promise<string[]> {
  const rows = await page.getByRole('table', { name: 'Ships' }).locator('tbody tr').all();
  const ids = await Promise.all(rows.map((row) => row.getAttribute('data-testid')));
  return ids.map((id) => (id ?? '').replace('fleet-row-', ''));
}

describe('the overview of a fleet larger than a page', () => {
  it('opens on its first 20 ships, argo first and then by name, asking the server one page', async () => {
    const { page, asked } = await signedIn();
    await page.waitForLoadState('networkidle');

    const expected = ['argo', ...Array.from({ length: PAGE_SIZE - 1 }, (_, index) => shipName(index + 1))];
    // The live updates' resync, sent as the socket opens, reads the first page once more (#1169).
    const pages = overviewPagesOf(asked);
    expect([await rowNames(page), pages.length <= 2, pages.filter((input) => input.cursor !== undefined)]).toEqual([expected, true, []]);
  });

  it('counts every ship the view selects, not the rows loaded', async () => {
    const { page } = await signedIn();

    await expect(page.getByTestId('fleet-count').textContent()).resolves.toBe(`${String(SHIPS + 1)} of ${String(SHIPS + 1)} ships`);
  });

  it('reads the next 20 with Load more, and offers no more after the last page', async () => {
    const { page, asked } = await signedIn();

    await page.getByTestId('fleet-load-more').click();
    await page.getByTestId(`fleet-row-${shipName(39)}`).waitFor();
    await page.getByTestId('fleet-load-more').click();
    await page.getByTestId(`fleet-row-${shipName(SHIPS)}`).waitFor();

    expect([(await rowNames(page)).length, await page.getByTestId('fleet-load-more').count(), overviewPagesOf(asked).filter((input) => input.cursor !== undefined)]).toEqual([
      SHIPS + 1,
      0,
      [expect.objectContaining({ limit: PAGE_SIZE }), expect.objectContaining({ limit: PAGE_SIZE })],
    ]);
  });

  it('asks the server to search, and shows the ships it answers', async () => {
    const { page, asked } = await signedIn();

    await page.getByTestId('fleet-search').fill('ship-4');
    await page.waitForURL(/q=ship-4/);
    await page.getByTestId('fleet-count').getByText('6 of').waitFor();

    expect([await rowNames(page), overviewPagesOf(asked).at(-1)]).toEqual([
      ['ship-40', 'ship-41', 'ship-42', 'ship-43', 'ship-44', 'ship-45'],
      expect.objectContaining({ query: 'ship-4', limit: PAGE_SIZE }),
    ]);
  });

  it('sorts by ship Z to A on the server, the last ships first', async () => {
    const { page, asked } = await signedIn();

    await page.getByTestId('fleet-sort-ship').getByRole('button').click();
    await page.waitForURL(/sort=ship/);
    await page.getByTestId('fleet-sort-ship').getByRole('button').click();
    await page.waitForURL(/order=desc/);
    await page.getByTestId(`fleet-row-${shipName(SHIPS)}`).waitFor();

    expect([(await rowNames(page)).slice(0, 2), overviewPagesOf(asked).at(-1)]).toEqual([
      [shipName(SHIPS), shipName(SHIPS - 1)],
      expect.objectContaining({ sort: { column: 'ship', direction: 'descending' }, limit: PAGE_SIZE }),
    ]);
  });
});
