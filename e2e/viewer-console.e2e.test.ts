import { SCOPES, type FleetId } from '@aeolus-fleet/common';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../packages/server/src/adapters/prisma/client.js';
import { createApp } from '../packages/server/src/app.js';
import type { AppRouter } from '../packages/server/src/index.js';
import { createUseCases } from '../packages/server/src/wiring.js';
import { FLEET_URL, modelOf, secretOf } from '../packages/server/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../packages/server/test/support/database.js';
import { newKey } from '../packages/server/test/support/keys.js';
import { unwrap } from '../packages/server/test/support/result.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';

// The read-only console of a viewer session (decision 0022), end to end: a
// fleet created with a viewer, a viewer ticket redeemed in the browser, and
// every write removed from the console, while the operator keeps them all.

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
  const created = await installation().fleets.create.mutate({ requestId: newKey(), name: 'demo', operatorEmail: 'demo@example.com', viewer: true });
  fleetId = created.fleetId;
  const argo = { fleetId, shipId: created.operatorShipId, kind: 'operator' as const, scopes: [...SCOPES] };
  const core = createUseCases({ prisma: database });
  const { shipId, secret } = unwrap(await core.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
  const { crewToken } = unwrap(await core.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'DEVICE' }, harness: 'claude-code' }));
  const scout = unwrap(await core.authenticate.byCrewToken(crewToken));
  unwrap(await core.sendMessage(scout, { ...modelOf(scout), selector: { kind: 'ship', shipId: created.operatorShipId }, payload: 'Run 71 passed', idempotencyKey: newKey() }));
});

afterAll(async () => {
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
  await web.stop();
  await server.close();
  await database.$disconnect();
});

async function signedIn(as: 'operator' | 'viewer'): Promise<Page> {
  const { ticket } = await installation().operators.issueSignInTicket.mutate({ fleetId, as });
  const context = await browser.newContext({ baseURL: web.url });
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(`/sign-in/ticket?ticket=${encodeURIComponent(ticket)}`);
  await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
  await page.getByRole('row', { name: /scout/ }).waitFor();
  return page;
}

describe('the console of a viewer session', () => {
  it('offers no Commission and no Compose, and names the viewer, reading only, in the account menu', async () => {
    const page = await signedIn('viewer');
    // The account answers once the session is known, so the writes it removes are settled by then.
    await page.locator('[data-testid="account-menu"][aria-label="Account menu, viewer, Read-only"]').first().waitFor();

    await expect(page.getByTestId('fleet-commission').count()).resolves.toBe(0);
    await expect(page.getByTestId('header-compose').count()).resolves.toBe(0);
  });

  it("offers only Copy ship id in a ship's row menu", async () => {
    const page = await signedIn('viewer');

    await page.getByRole('row', { name: /scout/ }).getByTestId('fleet-actions').click();

    await page.getByTestId('fleet-ship-copy-id').waitFor();
    await expect(page.getByTestId('fleet-ship-retire').count()).resolves.toBe(0);
    await expect(page.getByTestId('fleet-ship-message').count()).resolves.toBe(0);
  });

  it('shows the viewer ship with its viewer chip', async () => {
    const page = await signedIn('viewer');

    await page.getByRole('row', { name: /viewer/ }).getByTestId('fleet-viewer').waitFor();
  });
});

describe("a viewer session's read-only pages", () => {
  it("shows argo's inbox and opens a message, with no reply, no Mark done and a note that it is read-only", async () => {
    const page = await signedIn('viewer');

    await page.goto('/inbox');
    await page.getByText('Run 71 passed').first().click();

    await page.getByTestId('inbox-read-only').first().waitFor();
    await expect(page.getByTestId('inbox-reply').count()).resolves.toBe(0);
    await expect(page.getByTestId('inbox-mark-done').count()).resolves.toBe(0);
  });

  it('leaves the message unread for the operator: opening it as a viewer marks nothing', async () => {
    const viewer = await signedIn('viewer');
    await viewer.goto('/inbox');
    await viewer.getByText('Run 71 passed').first().click();
    await viewer.getByTestId('inbox-read-only').first().waitFor();

    const unread = await database.delivery.count({ where: { fleetId, readAt: null } });

    expect(unread).toBe(1);
  });
});

describe('the console of the operator, in a fleet with a viewer', () => {
  it('keeps Commission and Compose', async () => {
    const page = await signedIn('operator');

    await page.getByTestId('fleet-commission').waitFor();
    await page.getByTestId('header-compose').waitFor();
  });

  it('offers only Copy ship id for the viewer ship, which is never released, retired, renamed or sent to', async () => {
    const page = await signedIn('operator');

    await page.getByRole('row', { name: /viewer/ }).getByTestId('fleet-actions').click();

    await page.getByTestId('fleet-ship-copy-id').waitFor();
    await expect(page.getByTestId('fleet-ship-retire').count()).resolves.toBe(0);
    await expect(page.getByTestId('fleet-ship-rename').count()).resolves.toBe(0);
  });
});
