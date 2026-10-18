import type { FleetId } from '@aeolus-fleet/common';
import { SCOPES } from '@aeolus-fleet/common';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, BrowserContextOptions, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../packages/core/src/adapters/prisma/client.js';
import { createApp } from '../packages/core/src/app.js';
import type { AppRouter } from '../packages/core/src/index.js';
import { createUseCases } from '../packages/core/src/wiring.js';
import { FLEET_URL } from '../packages/core/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../packages/core/src/testing/database.js';
import { newKey } from '../packages/core/src/testing/keys.js';
import { unwrap } from '../packages/core/src/testing/result.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';

// The guide (decision 0024) brings a step's anchor into view before it points
// at it, at desktop and phone widths. The anchor is a retired ship's row, in
// the middle of a long overview with retired ships shown, and the window ends
// just above it: the step's popover then fits above the anchor, so nothing
// else scrolls the page.

const INSTALLATION_TOKEN = 'aeolus_installation_test_0123456789abcdef';
const DESKTOP = { viewport: { width: 1280, height: 800 } };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const SHIPS_ABOVE_AND_BELOW = 10;
let anchor = 'fleet-row-old';
/** How far below the fold the anchor starts, in pixels. */
const BELOW_THE_FOLD = 4;

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
  const created = await installation().fleets.create.mutate({ requestId: newKey(), name: 'harbour', operatorEmail: 'harbour@example.com', viewer: true });
  fleetId = created.fleetId;
  const argo = { fleetId, shipId: created.operatorShipId, kind: 'operator' as const, scopes: [...SCOPES] };
  const core = createUseCases({ prisma: database });
  for (let index = 0; index < SHIPS_ABOVE_AND_BELOW; index += 1) {
    unwrap(await core.commissionShip(argo, { idempotencyKey: newKey(), name: `builder-${String(index)}`, type: 'builder' }));
    unwrap(await core.commissionShip(argo, { idempotencyKey: newKey(), name: `warden-${String(index)}`, type: 'warden' }));
  }
  const old = unwrap(await core.commissionShip(argo, { idempotencyKey: newKey(), name: 'old', type: 'reviewer' }));
  unwrap(await core.retireShip(argo, { shipId: old.shipId }));
  await installation().guide.set.mutate({
    guide: {
      audience: 'viewers',
      steps: [
        { path: '/inbox', title: 'Messages to argo', text: 'What the fleet sends the operator.' },
        { path: '/?retired=1', anchor, title: 'Retired ships', text: 'A retired ship keeps its read-only page.' },
      ],
    },
  });
});

afterAll(async () => {
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
  await web.stop();
  await server.close();
  await database.$disconnect();
});

async function signedInViewer(options: BrowserContextOptions): Promise<Page> {
  const { ticket } = await installation().operators.issueSignInTicket.mutate({ fleetId, as: 'viewer' });
  const context = await browser.newContext({ baseURL: web.url, ...options });
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(`/sign-in/ticket?ticket=${encodeURIComponent(ticket)}`);
  await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
  return page;
}

/** Where the anchor this width shows sits in the window; null while it is not there. */
function anchorBox(page: Page): Promise<{ y: number; height: number } | null> {
  return page.locator(`[data-testid="${anchor}"]:visible`).first().boundingBox({ timeout: SETTLE_MS });
}

/** How long the anchor must stay put before the page counts as settled. */
const SETTLE_MS = 500;

/** Where the anchor sits once the page settles: the fleet's parts above it load in their own time. */
async function settledAnchorBox(page: Page): Promise<{ y: number; height: number }> {
  const isSettled = async (): Promise<boolean> => {
    const before = await anchorBox(page).catch(() => null);
    await page.waitForTimeout(SETTLE_MS);
    const after = await anchorBox(page).catch(() => null);
    return before !== null && before.y === after?.y;
  };
  await expect.poll(isSettled).toBe(true);
  const box = await anchorBox(page);
  if (box === null) {
    throw new Error('The overview shows no retired ship.');
  }
  return box;
}

/** Ends the window just above the anchor, at the width the page has, with the page at its top. */
async function foldJustAboveTheAnchor(page: Page): Promise<void> {
  await page.goto('/?retired=1');
  const box = await settledAnchorBox(page);
  const width = page.viewportSize()?.width ?? 0;
  await page.setViewportSize({ width, height: Math.floor(box.y) - BELOW_THE_FOLD });
}

/** Whether the anchor lies wholly inside the window once the page settles. */
async function isAnchorInView(page: Page): Promise<boolean> {
  const box = await settledAnchorBox(page);
  const windowHeight = page.viewportSize()?.height ?? 0;
  return box.y >= 0 && box.y + box.height <= windowHeight;
}

describe('a guide step whose anchor is below the fold', () => {
  it.each([
    ['desktop', DESKTOP],
    ['phone', PHONE],
  ])('scrolls its anchor into view before pointing at it, at %s width', async (_width, options) => {
    anchor = _width === 'phone' ? 'fleet-card-old' : 'fleet-row-old';
    await installation().guide.set.mutate({ guide: { audience: 'viewers', steps: [
      { path: '/inbox', title: 'Messages to argo', text: 'What the fleet sends the operator.' },
      { path: '/?retired=1', anchor, title: 'Retired ships', text: 'A retired ship keeps its read-only page.' },
    ] } });
    const page = await signedInViewer(options);
    await foldJustAboveTheAnchor(page);
    await page.goto('/inbox');
    await page.getByTestId('tour-step').getByText('Messages to argo').waitFor();

    await page.getByTestId('tour-step-next').click();

    const step = page.getByTestId('tour-step');
    await step.getByText('Retired ships').waitFor();
    await expect.poll(() => step.getAttribute('data-placement')).toBe('anchored');
    await expect(isAnchorInView(page)).resolves.toBe(true);
  });
});
