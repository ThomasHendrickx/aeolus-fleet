import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createPrismaClient, type PrismaClient } from '../packages/core/src/adapters/prisma/client.js';
import { createApp } from '../packages/core/src/app.js';
import type { ShipCaller } from '../packages/core/src/domain/shared/caller.js';
import { createUseCases, type UseCases } from '../packages/core/src/wiring.js';
import { FLEET_URL, OPERATOR, operatorCaller, secretOf } from '../packages/core/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../packages/core/src/testing/database.js';
import { createTestClock } from '../packages/core/test/support/postgres-core.js';
import { unwrap } from '../packages/core/src/testing/result.js';
import { signIn } from './support/console.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';
import { newKey } from '../packages/core/src/testing/keys.js';
import { withOperatorLogin } from '../packages/core/test/support/operator-login.js';

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
let argo: ShipCaller;
let server: FastifyInstance;
let serverUrl: string;
let web: RunningWeb;
let browser: Browser;
const contexts: BrowserContext[] = [];

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  useCases = createUseCases({ prisma: database, clock });
  argo = operatorCaller(unwrap(await withOperatorLogin(database, useCases.initialiseFleet({ name: 'home fleet' }))));

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
  call(operation: 'send' | 'receive' | 'ack' | 'report', body: Record<string, unknown>): Promise<unknown>;
}

async function crewedOverRest(ship: { name: string; type: string }): Promise<Session> {
  const { shipId, secret } = unwrap(await useCases.commissionShip(argo, { ...ship, idempotencyKey: newKey() }));
  const registered = await fetch(`${serverUrl}/api/v1/ship/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ shipId, secret: secretOf(secret), location: { kind: 'DEVICE' }, harness: 'claude-code' }),
  });
  const { crewToken } = z.object({ crewToken: z.string() }).parse(await registered.json());
  return {
    shipId,
    call: async (operation, body) => {
      const response = await fetch(`${serverUrl}/api/v1/ship/${operation}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${crewToken}` },
        body: JSON.stringify(operation === 'send' ? { model: 'claude-opus-5-5', ...body } : body),
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
  it('opens a message task from its report and shows the matching recipient progress', async () => {
    // Given a recipient reporting progress on a sent message.
    const sender = await crewedOverRest({ name: 'w2-sender', type: 'planner' });
    const recipient = await crewedOverRest({ name: 'w2-recipient', type: 'writer' });
    const { messageId } = sentSchema.parse(await sender.call('send', { selector: { kind: 'ship', shipId: recipient.shipId }, payload: 'Write the monitoring guide', idempotencyKey: newKey() }));
    await recipient.call('report', { state: 'working', note: 'Drafting the guide', task: { kind: 'message', fleetId: argo.fleetId, messageId }, step: { at: 1, of: 4 } });
    const page = await signedInPage();
    await page.goto(`/ships/${recipient.shipId}`);

    // When the viewer follows the server-authorized task link.
    await page.getByTestId('ship-report-task').click();
    const progress = page.getByTestId('message-recipient-progress');
    await progress.waitFor();

    // Then the message sheet opens, with progress separate from its delivery state.
    expect(page.url()).toContain(`/messages/${messageId}`);
    await expect(progress.textContent()).resolves.toContain('Working');
    await expect(progress.textContent()).resolves.toContain('step 1 of 4');
    await expect(progress.textContent()).resolves.toContain('Drafting the guide');
    await recipient.call('report', { state: 'working', task: null });
    await page.reload();
    await page.getByTestId('message-sheet').getByTestId('message-payload').waitFor();
    await expect(page.getByTestId('message-recipient-progress').count()).resolves.toBe(0);
  });

  it('shows two ships exchanging messages over the API: the thread and each delivery state, live, the delivery history, and the models they state', async () => {
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
    await messageRow(page, asked).getByText('Handed (pulled)').waitFor({ timeout: LIVE_TIMEOUT_MS });
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
      'DeliveryHanded',
      'MessageAccepted',
    ]);
    await sheet.getByText('"task": "review"').waitFor();
    // The model the planner's session stated with the message, and the scout's harness and current model in the header.
    await expect(sheet.getByTestId('message-model').textContent()).resolves.toBe('claude-opus-5-5');
    await expect(page.getByTestId('ship-model').textContent()).resolves.toMatch(/^Claude Code·claude-opus-5-5$/);
    // On the overview, the scout's row says what it runs on and its model.
    await page.goto('/');
    const row = page.getByTestId('fleet-row-scout');
    await expect(row.getByTestId('fleet-runs-on').getByTestId('fleet-model-hint').textContent()).resolves.toMatch(/^claude-opus-5-5, Model, stated /);
    await row.locator('[data-slot="location-tag"]').getByText('Claude Code').waitFor();
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
