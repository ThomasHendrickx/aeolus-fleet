import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { SCOPES } from '@aeolus-fleet/common';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Page } from 'playwright';
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
      signal: 'delivery-unacknowledged',
      occurrenceKey: 'dlv_01m66p4k2v9qz8f7x3n5c1d1v1',
      since: '2026-11-01T11:45:00.000Z',
      facts: { deliveryId: 'dlv_01m66p4k2v9qz8f7x3n5c1d1v1', messageId: 'msg_01m66p4k2v9qz8f7x3n5c1msg1', state: 'pending', awaitingCrew: true, minutes: 15 },
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

async function signedIn(device: Record<string, unknown> = {}): Promise<Page> {
  const { ticket } = await installation().operators.issueSignInTicket.mutate({ fleetId });
  const context = await browser.newContext({ baseURL: web.url, ...device });
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(`/sign-in/ticket?ticket=${encodeURIComponent(ticket)}`);
  await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
  return page;
}

/** A ship's tile on Harbour, by the name it shows. */
function tileOf(page: Page, name: string) {
  return page.getByTestId('harbour').getByTestId('harbour-tile').filter({ has: page.getByText(name, { exact: true }) });
}

/** The numbers as Harbour shows them, by their test ids. */
async function numbersOf(page: Page): Promise<Record<string, string>> {
  const words = ['ships', 'alert', 'waiting', 'working', 'idle'] as const;
  const shown = await Promise.all(words.map(async (word) => [word, await page.getByTestId(`harbour-number-${word}`).innerText()] as const));
  return Object.fromEntries(shown);
}

describe('Harbour on the fleet overview', () => {
  it('counts the active ships by state and shows one tile per ship, grouped by kind, alerts first', async () => {
    const page = await signedIn();
    const harbour = page.getByTestId('harbour');
    await tileOf(page, 'builder').getByText('Working').waitFor();

    await expect(numbersOf(page)).resolves.toEqual({ ships: '4\nShips', alert: '1\nAlert', waiting: '1\nWaiting', working: '1\nWorking', idle: '1\nIdle' });
    await expect(page.getByTestId('harbour-group-people').getByTestId('harbour-tile').allInnerTexts()).resolves.toEqual(['argo\nIdle']);
    await expect(page.getByTestId('harbour-group-agents').getByTestId('harbour-tile').allInnerTexts()).resolves.toEqual(['builder-gateway\nAlert', 'reviewer-1\nWaiting', 'builder\nWorking']);
    await expect(harbour.getByText('old').count()).resolves.toBe(0);
  });

  it("shows what a ship is doing in its tile's title, and the state where the ship has not reported", async () => {
    const page = await signedIn();
    const harbour = page.getByTestId('harbour');

    await tileOf(page, 'builder').getByText('Working').waitFor();

    await expect(Promise.all([harbour.getByTitle('builder: Building the harbour').count(), harbour.getByTitle('reviewer-1: Waiting').count()])).resolves.toEqual([1, 1]);
  });

  it('shows a long name whole in its tile on phone, three tiles across', async () => {
    const page = await signedIn(PHONE);
    const name = page.getByTestId('harbour').getByText('builder-gateway', { exact: true });
    await name.waitFor();

    // Not cut short: the text takes no more room than its tile gives it.
    await expect(
      page.evaluate("(() => { const name = [...document.querySelectorAll('[data-testid=harbour-tile] span')].find((span) => span.textContent === 'builder-gateway'); return name.scrollWidth <= name.clientWidth; })()"),
    ).resolves.toBe(true);
  });

  it("moves a ship's tile live when its crew reports blocked, without a reload", async () => {
    const page = await signedIn();
    await tileOf(page, 'builder').getByText('Working').waitFor();

    unwrap(await core.report(unwrap(builderCrew), { state: 'blocked', note: 'Waiting for a review' }));

    await tileOf(page, 'builder').getByText('Waiting').waitFor();
    await expect(numbersOf(page)).resolves.toMatchObject({ waiting: '2\nWaiting', working: '0\nWorking' });
  });
});
