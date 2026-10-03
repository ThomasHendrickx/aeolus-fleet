import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createPrismaClient, type PrismaClient } from '../packages/server/src/adapters/prisma/client.js';
import { createApp } from '../packages/server/src/app.js';
import type { Caller } from '../packages/server/src/core/shared/caller.js';
import { createUseCases, type UseCases } from '../packages/server/src/wiring.js';
import { FLEET_URL, OPERATOR, operatorCaller, secretIn } from '../packages/server/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../packages/server/test/support/database.js';
import { createTestClock } from '../packages/server/test/support/postgres-core.js';
import { unwrap } from '../packages/server/test/support/result.js';
import { signIn } from './support/console.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';
import { newKey } from '../packages/server/test/support/keys.js';

// The ship page, end to end: two ships exchange messages over the REST API
// as their sessions would, and the page of one shows the thread and each
// delivery state as it changes, without a reload, and the message's delivery
// history in the MessageSheet.

const clock = createTestClock('2026-10-01T09:00:00.000Z');
/** A live change shows within this. */
const LIVE_TIMEOUT_MS = 20_000;
/** A receive returns at once when it has deliveries; an empty one waits no longer than this. */
const RECEIVE_WAIT_MS = 500;

let database: PrismaClient;
let useCases: UseCases;
let argo: Caller;
let server: FastifyInstance;
let serverUrl: string;
let web: RunningWeb;
let browser: Browser;
const contexts: BrowserContext[] = [];

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  useCases = createUseCases({ prisma: database, clock, fleetUrl: FLEET_URL });
  argo = operatorCaller(unwrap(await useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR })));

  const webUrl = await reserveWebUrl();
  server = createApp({
    databaseUrl,
    publicUrl: FLEET_URL,
    consoleOrigin: webUrl,
    clock,
    logger: false,
    receiveWaitMs: RECEIVE_WAIT_MS,
  });
  serverUrl = await server.listen({ host: '127.0.0.1', port: 0 });
  web = await startWeb({ url: webUrl, serverUrl });
  browser = await launchChromium();
});

afterAll(async () => {
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
  await web.stop();
  await server.close();
  await database.$disconnect();
});

/** A ship's session on the REST API, as its starting prompt tells it to connect. */
interface Session {
  shipId: string;
  call(operation: 'send' | 'receive' | 'ack', body: Record<string, unknown>): Promise<unknown>;
}

async function crewedOverRest(ship: { name: string; type: string }): Promise<Session> {
  const { shipId, prompt } = unwrap(await useCases.commissionShip(argo, { ...ship, idempotencyKey: newKey() }));
  const registered = await fetch(`${serverUrl}/api/v1/ship/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ shipId, secret: secretIn(prompt), location: { kind: 'DEVICE' } }),
  });
  const { crewToken } = z.object({ crewToken: z.string() }).parse(await registered.json());
  return {
    shipId,
    call: async (operation, body) => {
      const response = await fetch(`${serverUrl}/api/v1/ship/${operation}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${crewToken}` },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(200);
      return response.json();
    },
  };
}

const sentSchema = z.object({ messageId: z.string() });
const receivedSchema = z.object({ deliveries: z.array(z.object({ deliveryId: z.string(), messageId: z.string() })) });

async function signedInPage(): Promise<Page> {
  const context = await browser.newContext({ baseURL: web.url });
  contexts.push(context);
  const page = await context.newPage();
  await signIn(page, OPERATOR);
  await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
  return page;
}

function messageRow(page: Page, messageId: string) {
  return page.locator(`[data-testid="message-row"][data-message-id="${messageId}"]`);
}

describe('the ship page', () => {
  it('shows two ships exchanging messages over the API: the thread and each delivery state, live, and the delivery history', async () => {
    const planner = await crewedOverRest({ name: 'planner', type: 'planner' });
    const scout = await crewedOverRest({ name: 'scout', type: 'reviewer' });
    const page = await signedInPage();
    await page.getByRole('link', { name: 'scout', exact: true }).click();
    await page.waitForURL(`${web.url}/ships/${scout.shipId}`);
    await page.getByTestId('ship-header').getByText('Crewed', { exact: true }).first().waitFor();
    await page.getByRole('tab', { name: 'Messages' }).click();
    await page.waitForURL(`${web.url}/ships/${scout.shipId}?tab=messages`);

    const asked = sentSchema.parse(
      await planner.call('send', {
        selector: { kind: 'ship', name: 'scout' },
        payload: '{"task":"review","pr":48}',
        contentType: 'application/json',
        idempotencyKey: 'ask-scout',
      }),
    ).messageId;
    await messageRow(page, asked).getByText('Pending').waitFor({ timeout: LIVE_TIMEOUT_MS });

    const [delivery] = receivedSchema.parse(await scout.call('receive', { max: 1 })).deliveries;
    await messageRow(page, asked).getByText('In flight').waitFor({ timeout: LIVE_TIMEOUT_MS });
    await scout.call('ack', { deliveryId: delivery?.deliveryId });
    await messageRow(page, asked).getByText('Acknowledged').waitFor({ timeout: LIVE_TIMEOUT_MS });

    const answered = sentSchema.parse(
      await scout.call('send', {
        selector: { kind: 'ship', name: 'planner' },
        payload: 'Reviewed: two comments on PR 48',
        idempotencyKey: 'answer-planner',
        inReplyTo: asked,
      }),
    ).messageId;
    const thread = page.getByTestId('message-thread').filter({ has: messageRow(page, asked) });
    await thread.locator(`[data-message-id="${answered}"]`).getByText('Pending').waitFor({ timeout: LIVE_TIMEOUT_MS });
    await expect(page.getByTestId('message-thread').count()).resolves.toBe(1);

    await page.getByRole('tab', { name: 'Timeline' }).click();
    const timeline = page.getByTestId('ship-timeline');
    await timeline.locator('[data-type="MessageAccepted"]').filter({ hasText: 'Sent a message to' }).waitFor();
    await timeline.locator('[data-type="DeliveryAcknowledged"]').waitFor();

    await page.getByRole('tab', { name: 'Messages' }).click();
    await messageRow(page, asked).click();
    const sheet = page.getByTestId('message-sheet');
    await sheet.waitFor();
    expect(page.url()).toContain(`message=${asked}`);
    const history = sheet.getByTestId('delivery-history-entry');
    await history.nth(2).waitFor();
    const types = await Promise.all((await history.all()).map((entry) => entry.getAttribute('data-type')));
    expect(types).toEqual([
      'DeliveryAcknowledged',
      'DeliveryClaimed',
      'MessageAccepted',
    ]);
    await sheet.getByText('"task": "review"').waitFor();
  });

  it("replies as argo from a message's sheet: the reply reaches its sender, naming the message", async () => {
    const helmsman = await crewedOverRest({ name: 'helmsman', type: 'planner' });
    const deckhand = await crewedOverRest({ name: 'deckhand', type: 'reviewer' });
    const asked = sentSchema.parse(
      await helmsman.call('send', {
        selector: { kind: 'ship', shipId: deckhand.shipId },
        payload: 'Which branch?',
        idempotencyKey: 'which-branch',
      }),
    ).messageId;
    const page = await signedInPage();
    await page.goto(`/ships/${deckhand.shipId}?tab=messages&message=${asked}`);
    const sheet = page.getByTestId('message-sheet');

    await sheet.getByTestId('message-reply').click();
    const dialog = page.getByTestId('compose-dialog');
    await dialog.getByTestId('compose-payload').fill('main');
    await dialog.getByTestId('compose-send').click();

    await dialog.waitFor({ state: 'hidden' });
    const replied = z
      .object({ deliveries: z.array(z.object({ payload: z.string(), inReplyTo: z.string().nullable() })) })
      .parse(await helmsman.call('receive', {}));
    expect(replied.deliveries).toEqual([expect.objectContaining({ payload: 'main', inReplyTo: asked })]);
  });
});
