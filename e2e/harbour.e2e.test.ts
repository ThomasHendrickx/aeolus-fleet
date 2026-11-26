import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { SCOPES } from '@aeolus-fleet/common';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Page, Route } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../packages/core/src/adapters/prisma/client.js';
import { createApp } from '../packages/core/src/app.js';
import type { ShipCaller } from '../packages/core/src/domain/shared/caller.js';
import type { AppRouter } from '../packages/core/src/index.js';
import { createUseCases } from '../packages/core/src/wiring.js';
import { FLEET_URL, secretOf } from '../packages/core/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../packages/core/src/testing/database.js';
import { newKey } from '../packages/core/src/testing/keys.js';
import { unwrap } from '../packages/core/src/testing/result.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';

// Harbour on the fleet overview, end to end (docs/design/fleet-overview): a
// fleet of argo, builder crewed and working, reviewer-1 awaiting crew,
// builder-gateway with an open alert, and old retired. The numbers count the
// four active ships by state, the tiles group them by kind, a tap shows
// what a ship is doing, and a tile follows its ship live.

const INSTALLATION_TOKEN = 'aeolus_installation_test_0123456789abcdef';

let database: PrismaClient;
let server: FastifyInstance;
let serverUrl: string;
let web: RunningWeb;
let browser: Browser;
const contexts: BrowserContext[] = [];
let fleetId: FleetId;
let core: ReturnType<typeof createUseCases>;
let argo: ShipCaller;
let builderCrew: Awaited<ReturnType<ReturnType<typeof createUseCases>['authenticate']['byCrewToken']>>;
let deployBotId: ShipId;

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
  argo = { fleetId, shipId: created.operatorShipId, kind: 'operator', scopes: [...SCOPES] };
  core = createUseCases({ prisma: database });
  const builder = unwrap(await core.commissionShip(argo, { idempotencyKey: newKey(), name: 'builder', type: 'builder' }));
  const { crewToken } = unwrap(await core.claimShip({ shipId: builder.shipId, secret: secretOf(builder.secret), location: { kind: 'DEVICE' }, harness: 'claude-code' }));
  builderCrew = await core.authenticate.byCrewToken(crewToken);
  unwrap(await core.report(unwrap(builderCrew), { state: 'working', note: 'Building the harbour' }));
  unwrap(await core.commissionShip(argo, { idempotencyKey: newKey(), name: 'reviewer-1', type: 'reviewer' }));
  deployBotId = unwrap(await core.commissionShip(argo, { idempotencyKey: newKey(), name: 'builder-gateway', type: 'deployer' })).shipId;
  unwrap(
    await core.raiseAlert(argo, {
      shipId: deployBotId,
      signal: 'plugin-read-failed',
      occurrenceKey: 'guard.get:2026-11-01T11:45:00.000Z',
      since: '2026-11-01T11:45:00.000Z',
      facts: { read: 'guard.get', reason: 'no-answer', minutes: 15 },
    }),
  );
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

/** Harbour's reads (fleet.harbour, alone or in a batch), held or failed by a test. */
const HARBOUR_READ = /\/trpc\/[^?]*fleet\.harbour/;

async function signedIn(device: Record<string, unknown> = {}, onHarbourRead?: (route: Route) => Promise<void>): Promise<Page> {
  const { ticket } = await installation().operators.issueSignInTicket.mutate({ fleetId });
  const context = await browser.newContext({ baseURL: web.url, ...device });
  contexts.push(context);
  const page = await context.newPage();
  if (onHarbourRead !== undefined) {
    await page.route(HARBOUR_READ, onHarbourRead);
  }
  await page.goto(`/sign-in/ticket?ticket=${encodeURIComponent(ticket)}`);
  await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
  return page;
}

/** A ship's tile on Harbour, by the name it shows. */
function tileOf(page: Page, name: string) {
  return page.getByTestId('harbour').getByTestId('harbour-tile').filter({ has: page.getByText(name, { exact: true }) });
}

/** A group's tiles in the order shown, each as its name and state. */
async function tilesIn(page: Page, kind: 'people' | 'agents'): Promise<string[]> {
  const tiles = await page.getByTestId(`harbour-group-${kind}`).getByTestId('harbour-tile').all();
  return Promise.all(tiles.map(async (tile) => `${(await tile.innerText()).split('\n')[0] ?? ''} ${(await tile.getAttribute('data-state')) ?? ''}`));
}

/** The numbers as Harbour shows them, by their test ids. */
async function numbersOf(page: Page): Promise<Record<string, string>> {
  const words = ['ships', 'alert', 'awaitingCrew', 'blocked', 'working', 'idle'] as const;
  const shown = await Promise.all(words.map(async (word) => [word, await page.getByTestId(`harbour-number-${word}`).innerText()] as const));
  return Object.fromEntries(shown);
}

describe('Harbour on the fleet overview', () => {
  it.each(['cards', 'list'])('names the failed plugin read and its reason in Open alerts in %s view', async (view) => {
    const page = await signedIn({ reducedMotion: 'reduce' });
    await page.clock.setFixedTime(new Date('2026-11-01T12:00:00.000Z'));

    await page.goto(`/?view=${view}`);

    const panel = page.getByTestId('fleet-open-alerts');
    await panel.getByRole('heading', { name: 'Open alerts · 1' }).waitFor();
    await panel.getByText('builder-gateway', { exact: true }).waitFor();
    await panel.getByText(/guard\.get, no answer/).waitFor();
  });

  it('shows Open alerts outside the Harbour region in cards view', async () => {
    const page = await signedIn({ reducedMotion: 'reduce' });
    await page.clock.setFixedTime(new Date('2026-11-01T12:00:00.000Z'));

    await page.goto('/?view=cards');

    const alerts = page.getByRole('region', { name: 'Open alerts · 1', exact: true });
    const harbour = page.getByRole('region', { name: 'Harbour', exact: true });
    await alerts.waitFor();
    await harbour.getByRole('region', { name: 'Agents', exact: true }).waitFor();
    await expect.poll(() => harbour.getByRole('region', { name: 'Open alerts · 1', exact: true }).count()).toBe(0);
  });

  it('counts the active ships by state and shows one tile per ship, grouped by kind, alerts first', async () => {
    const page = await signedIn();
    const harbour = page.getByTestId('harbour');
    await tileOf(page, 'builder').getByText('Working', { exact: true }).waitFor();

    await expect(numbersOf(page)).resolves.toEqual({ ships: '4\nShips', alert: '1\nAlert', awaitingCrew: '1\nAwaiting crew', blocked: '0\nBlocked', working: '1\nWorking', idle: '1\nIdle' });
    await expect(tilesIn(page, 'people')).resolves.toEqual(['argo idle']);
    await expect(tilesIn(page, 'agents')).resolves.toEqual(['builder-gateway alert', 'reviewer-1 awaitingCrew', 'builder working']);
    await expect(harbour.getByText('old').count()).resolves.toBe(0);
  });

  it("shows what a ship is doing in its tile's title, and the state where the ship has not reported", async () => {
    const page = await signedIn();
    const harbour = page.getByTestId('harbour');

    await tileOf(page, 'builder').getByText('Working', { exact: true }).waitFor();

    await expect(Promise.all([harbour.getByTitle('builder: Building the harbour').count(), harbour.getByTitle('reviewer-1: Awaiting crew').count()])).resolves.toEqual([1, 1]);
  });

  it("opens the ship's page when its tile is tapped on phone", async () => {
    const page = await signedIn(PHONE);

    await tileOf(page, 'builder').tap();

    await page.waitForURL(/\/ships\/shp_/);
    await page.getByTestId('ship-header').getByText('builder', { exact: true }).first().waitFor();
  });

  it("opens the ship's page when its tile is clicked on desktop", async () => {
    const page = await signedIn();

    await tileOf(page, 'reviewer-1').click();

    await page.waitForURL(/\/ships\/shp_/);
    await page.getByTestId('ship-header').getByText('reviewer-1', { exact: true }).first().waitFor();
  });

  it("shows a long name whole in its tile on the mockup's 375 px phone, two tiles across, on two lines where one is too narrow", async () => {
    const page = await signedIn({ ...PHONE, viewport: { width: 375, height: 812 } });
    await tileOf(page, 'builder-gateway').waitFor();

    // Not cut short: the name takes no more room than its tile gives it, across or down.
    const name = tileOf(page, 'builder-gateway').getByText('builder-gateway', { exact: true });
    const isWhole = await name.evaluate((span: { scrollWidth: number; clientWidth: number; scrollHeight: number; clientHeight: number }) => span.scrollWidth <= span.clientWidth && span.scrollHeight <= span.clientHeight);
    const rowsOfFirstTwoTiles = await page
      .getByTestId('harbour-group-agents')
      .getByTestId('harbour-tile')
      .evaluateAll((tiles: { getBoundingClientRect(): { top: number } }[]) => new Set(tiles.slice(0, 2).map((tile) => tile.getBoundingClientRect().top)).size);
    expect([isWhole, rowsOfFirstTwoTiles]).toEqual([true, 1]);
  });

  it("moves a ship's tile live when its crew reports blocked, without a reload", async () => {
    const page = await signedIn();
    await tileOf(page, 'builder').getByText('Working', { exact: true }).waitFor();

    unwrap(await core.report(unwrap(builderCrew), { state: 'blocked', note: 'Waiting for a review' }));

    await tileOf(page, 'builder').getByText('Blocked', { exact: true }).waitFor();
    await expect.poll(() => numbersOf(page)).toMatchObject({ awaitingCrew: '1\nAwaiting crew', blocked: '1\nBlocked', working: '0\nWorking' });
  });

  it('shows the shape that is coming while the fleet is read, without the bar or a line under the title', async () => {
    const read = Promise.withResolvers<undefined>();
    const page = await signedIn({}, async (route) => {
      await read.promise;
      await route.continue();
    });

    await page.getByTestId('harbour-loading').waitFor();

    await expect(Promise.all([page.getByTestId('fleet-bar').count(), page.getByText('Loading your fleet').count()])).resolves.toEqual([0, 0]);
    read.resolve(undefined);
  });

  it('says the read failed with Try again, without the bar or a line under the title', async () => {
    const page = await signedIn({}, (route) => route.abort());

    await page.getByTestId('harbour-error').waitFor();

    await expect(Promise.all([page.getByTestId('harbour-retry').count(), page.getByTestId('fleet-bar').count(), page.getByText('Loading your fleet').count()])).resolves.toEqual([1, 0, 0]);
  });
});
