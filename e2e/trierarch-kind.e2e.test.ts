import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

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

// Approved trierarch-kind screens, through the running console and a real database.

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
let computerId: ShipId;

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
  const computer = unwrap(await core.commissionShip(argo, { idempotencyKey: newKey(), name: 'mac-studio', type: 'trierarch', scopes: ['crew:run'] }));
  computerId = computer.shipId;
  const { crewToken: computerToken } = unwrap(await core.claimShip({ shipId: computerId, secret: secretOf(computer.secret), location: { kind: 'SERVER' } }));
  const computerCrew = unwrap(await core.authenticate.byCrewToken(computerToken));
  unwrap(await core.report(computerCrew, { state: 'working', note: 'Crewing 4 ships' }));
  unwrap(await core.setStatement(computerCrew, { summary: 'I crew the ships assigned to this computer.', capabilities: [] }));
  unwrap(await core.commissionShip(argo, { idempotencyKey: newKey(), name: 'trierarch-plugin', type: 'trierarch-plugin', kind: 'plugin' }));
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

/** Optional screenshot evidence uses the same running screens as this acceptance test. */
async function capture(page: Page, { screen, theme }: { screen: string; theme: string }): Promise<void> {
  const directory = process.env.TRIERARCH_SCREENSHOTS;
  if (directory === undefined) return;
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: join(directory, `${screen}-${process.env.TRIERARCH_CAPTURE_PHASE ?? 'after'}-${theme}.png`), fullPage: true });
}

describe('the approved trierarch-kind screens', () => {
  it.each(['light', 'dark'] as const)('shows Trierarchs between Agents and Plugins and a separate kind on details in %s', async (theme) => {
    // Given the computer after its in-place kind migration.
    await database.$executeRaw`UPDATE ships SET kind = 'trierarch' WHERE id = ${computerId}`;
    const page = await signedIn({ viewport: { width: 1440, height: 1100 }, colorScheme: theme });
    await page.getByRole('region', { name: 'Trierarchs', exact: true }).waitFor();
    await page.evaluate("document.documentElement.classList.toggle('dark', " + String(theme === 'dark') + ')');

    // When the operator opens the computer at each approved viewport.
    await capture(page, { screen: 'harbour', theme });
    const harbour = page.getByRole('region', { name: 'Harbour', exact: true });
    const groupNames = await harbour.getByRole('region').evaluateAll((groups) => groups.map((group) => group.getAttribute('aria-label')));
    const computers = await page.getByRole('region', { name: 'Trierarchs', exact: true }).getByText('mac-studio', { exact: true }).count();
    const plugins = await page.getByRole('region', { name: 'Plugins', exact: true }).getByText('trierarch-plugin', { exact: true }).count();
    const viewports = [];
    for (const width of [375, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1100 });
      const doesHarbourFit = await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth');
      await tileOf(page, 'mac-studio').click();
      await page.getByRole('heading', { name: 'mac-studio', exact: true }).waitFor();
      viewports.push({
        width,
        doesHarbourFit,
        doDetailsFit: await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'),
        kind: await page.getByText('Kind: Trierarch', { exact: true }).innerText(),
        type: await page.getByText('trierarch', { exact: true }).count(),
        crewRequest: await page.getByText('No crew requested', { exact: true }).count(),
        ping: await page.getByRole('button', { name: 'Ping', exact: true }).count(),
        delivery: await page.getByText('Delivery', { exact: true }).count(),
      });
      if (width === 1440) await capture(page, { screen: 'details', theme });
      await page.goto('/');
      await page.getByRole('region', { name: 'Trierarchs', exact: true }).waitFor();
    }

    // Then the approved group, kind, crew request, Ping and Delivery survive at every width.
    expect(groupNames).toEqual(['People', 'Agents', 'Trierarchs', 'Plugins']);
    expect(computers).toBe(1);
    expect(plugins).toBe(1);
    expect(viewports).toEqual([375, 1440, 1920].map((width) => ({ width, doesHarbourFit: true, doDetailsFit: true, kind: 'Kind: Trierarch', type: 1, crewRequest: 1, ping: 1, delivery: 1 })));
  });
});
