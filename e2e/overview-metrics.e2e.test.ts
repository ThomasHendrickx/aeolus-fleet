import type { FleetId } from '@aeolus-fleet/common';
import { SCOPES } from '@aeolus-fleet/common';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../packages/server/src/adapters/prisma/client.js';
import { createApp } from '../packages/server/src/app.js';
import type { AppRouter } from '../packages/server/src/index.js';
import { createUseCases } from '../packages/server/src/wiring.js';
import { FLEET_URL, secretOf } from '../packages/server/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../packages/server/test/support/database.js';
import { newKey } from '../packages/server/test/support/keys.js';
import { unwrap } from '../packages/server/test/support/result.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';

// The overview, end to end: a fleet with one ship crewed, one awaiting crew
// and one retired; the metric cards count them and open what they count, the
// crewed ship's model has its tooltip and the retired one its day.

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
  const builder = unwrap(await core.commissionShip(argo, { idempotencyKey: newKey(), name: 'builder', type: 'builder' }));
  const { crewToken } = unwrap(await core.claimShip({ shipId: builder.shipId, secret: secretOf(builder.secret), location: { kind: 'DEVICE' }, harness: 'claude-code' }));
  const crew = unwrap(await core.authenticate.byCrewToken(crewToken));
  unwrap(await core.sendMessage(crew, { selector: { kind: 'ship', shipId: created.operatorShipId }, payload: 'Built', model: 'claude-opus-5-5', idempotencyKey: newKey() }));
  unwrap(await core.commissionShip(argo, { idempotencyKey: newKey(), name: 'reviewer-1', type: 'reviewer' }));
  const old = unwrap(await core.commissionShip(argo, { idempotencyKey: newKey(), name: 'old', type: 'reviewer' }));
  unwrap(await core.retireShip(argo, { shipId: old.shipId }));
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

describe("the overview's metric cards", () => {
  it('counts the ships crewed and awaiting crew, names the longest wait, and says the active ships and argo', async () => {
    const page = await signedIn();

    await page.getByTestId('overview-crewed').getByText('of 2 active ships').first().waitFor();
    await page.getByTestId('overview-awaiting').getByText(/Longest wait: reviewer-1, \d+ min/).first().waitFor();
    await page.getByText('2 active ships and argo, 1 retired. Changes appear as they happen.').first().waitFor();

    await expect(page.getByTestId('overview-attention').getByText('Nothing needs you').count()).resolves.toBeGreaterThan(0);
  });

  it('opens the ships awaiting crew from its card', async () => {
    const page = await signedIn();

    await page.getByTestId('overview-awaiting').click();
    await page.waitForURL(/status=awaitingCrew/);
    await page.getByRole('row', { name: /reviewer-1/ }).waitFor();

    await expect(page.getByRole('row', { name: /builder/ }).count()).resolves.toBe(0);
  });
});

describe('the overview rows', () => {
  it("shows the crewed ship's model, what it is and when it was stated, in a tooltip", async () => {
    const page = await signedIn();

    await page.getByRole('row', { name: /builder/ }).getByTestId('fleet-model').hover();

    await page.locator('[data-slot="tooltip-content"]').getByText(/^Model, stated /).waitFor();
  });

  it('shows the day a retired ship was retired in Runs on', async () => {
    const page = await signedIn();

    await page.getByTestId('fleet-show-retired').click();

    await page.getByRole('row', { name: /old/ }).getByTestId('fleet-retired-on').getByText(/^Retired \d+ [A-Z][a-z]{2}$/).waitFor();
  });
});

describe('the phone filters', () => {
  it('filters to the ships awaiting crew in the sheet, shows the filter as a chip and clears it', async () => {
    const page = await signedIn(PHONE);
    await page.getByTestId('fleet-card-builder').waitFor();

    await page.getByRole('button', { name: 'Filter ships' }).click();
    await page.getByRole('radio', { name: 'Awaiting crew' }).click();
    await page.getByRole('button', { name: 'Show 1 ship' }).click();

    await page.getByTestId('fleet-filter-chips').getByText('Status: Awaiting crew').waitFor();
    await page.getByRole('button', { name: 'Filter ships, 1 active' }).waitFor();
    await expect(page.getByTestId('fleet-card-builder').count()).resolves.toBe(0);
    await page.getByTestId('fleet-filter-chips').getByRole('button', { name: 'Clear filters' }).click();
    await page.getByTestId('fleet-card-builder').waitFor();
  });
});
