import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { SCOPES } from '@aeolus-fleet/common';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Locator, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../packages/core/src/adapters/prisma/client.js';
import { createApp } from '../packages/core/src/app.js';
import type { AppRouter } from '../packages/core/src/index.js';
import { createUseCases } from '../packages/core/src/wiring.js';
import { FLEET_URL } from '../packages/core/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../packages/core/test/support/database.js';
import { newKey } from '../packages/core/test/support/keys.js';
import { unwrap } from '../packages/core/test/support/result.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';

// The guide (decision 0024) on a phone (#721): a step about a ship timeline's
// newest entry and the entries just below it leaves both in sight beside its
// popover, rather than covering what follows the anchor.

const INSTALLATION_TOKEN = 'aeolus_installation_test_0123456789abcdef';
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
/** Renames that fill the timeline past the fold, so its newest entry can sit mid window. */
const RENAMES = 12;
const ANCHOR = 'ship-timeline-entry';
/** How long a box must stay put before the page counts as settled. */
const SETTLE_MS = 500;

let database: PrismaClient;
let server: FastifyInstance;
let serverUrl: string;
let web: RunningWeb;
let browser: Browser;
const contexts: BrowserContext[] = [];
let fleetId: FleetId;
let shipId: ShipId;

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
  ({ shipId } = unwrap(await core.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout-0', type: 'scout' })));
  for (let index = 1; index <= RENAMES; index += 1) {
    unwrap(await core.renameShip(argo, { shipId, name: `scout-${String(index)}` }));
  }
  await installation().guide.set.mutate({
    guide: {
      audience: 'viewers',
      steps: [{ path: `/ships/${shipId}`, anchor: ANCHOR, title: 'What happened last', text: 'The newest change sits on top; older ones follow below it.' }],
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

async function signedInViewer(): Promise<Page> {
  const { ticket } = await installation().operators.issueSignInTicket.mutate({ fleetId, as: 'viewer' });
  const context = await browser.newContext({ baseURL: web.url, ...PHONE });
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(`/sign-in/ticket?ticket=${encodeURIComponent(ticket)}`);
  await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
  return page;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function overlaps(one: Box, other: Box): boolean {
  return one.x < other.x + other.width && other.x < one.x + one.width && one.y < other.y + other.height && other.y < one.y + one.height;
}

/** Where each part sits once none moves for SETTLE_MS: the popover fades in and the page scrolls to the anchor. */
async function settled(locators: [Locator, Locator, Locator]): Promise<[Box, Box, Box]> {
  const read = () => Promise.all(locators.map((locator) => locator.boundingBox({ timeout: SETTLE_MS }).catch(() => null)));
  const isSettled = async (): Promise<boolean> => {
    const before = await read();
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    const after = await read();
    return after.every((box, index) => box !== null && JSON.stringify(box) === JSON.stringify(before[index]));
  };
  await expect.poll(isSettled).toBe(true);
  const [first, second, third] = await read();
  if (!first || !second || !third) {
    throw new Error('A part of the step left the page.');
  }
  return [first, second, third];
}

describe('a guide step on a phone', () => {
  it('leaves its anchor and the entry below it in sight beside its popover', async () => {
    const page = await signedInViewer();
    await page.goto(`/ships/${shipId}`);
    const step = page.getByTestId('tour-step');
    await step.getByText('What happened last').waitFor();
    await expect.poll(() => step.getAttribute('data-placement')).toBe('anchored');
    const entries = page.locator(`[data-testid="${ANCHOR}"]:visible`);
    await expect.poll(() => entries.count()).toBeGreaterThan(RENAMES);

    const [popover, newest, next] = await settled([step, entries.nth(0), entries.nth(1)]);

    for (const entry of [newest, next]) {
      expect(entry.y).toBeGreaterThanOrEqual(0);
      expect(entry.y + entry.height).toBeLessThanOrEqual(PHONE.viewport.height);
      expect(overlaps(popover, entry)).toBe(false);
    }
  });
});
