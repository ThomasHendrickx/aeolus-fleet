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

// Needs attention, end to end: a ship's session receives a message five
// times over the REST API without acknowledging it, the delivery shows in
// Needs attention live with its count in the navigation, and the operator
// resends one (a new message reaches the ship) and dismisses another.

const clock = createTestClock('2026-10-01T09:00:00.000Z');
/** A live change shows within this. */
const LIVE_TIMEOUT_MS = 20_000;
/** A receive returns at once when it has deliveries; an empty one waits no longer than this. */
const RECEIVE_WAIT_MS = 500;
/** The claim that makes a delivery never acknowledged undeliverable. */
const UNDELIVERABLE_AT_CLAIM = 5;
/** Sign-ins are rate limited per window; each test signs in after the window of the one before. */
const SIGN_IN_WINDOW_MS = 60_000;

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
  call(operation: 'send' | 'receive', body: Record<string, unknown>): Promise<unknown>;
}

async function crewedOverRest(ship: { name: string; type: string }): Promise<Session> {
  const { shipId, prompt } = unwrap(await useCases.commissionShip(argo, { ...ship, idempotencyKey: newKey() }));
  const registered = await fetch(`${serverUrl}/api/v1/ship/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ shipId, secret: secretIn(prompt), location: { kind: 'DEVICE' }, harness: 'claude-code' }),
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

/** The sender's message to the receiver, which the receiver's session takes five times without acknowledging it. */
async function undeliverable(message: { from: Session; to: Session; payload: string }): Promise<string> {
  const { from, to, payload } = message;
  const { messageId } = sentSchema.parse(
    await from.call('send', { selector: { kind: 'ship', shipId: to.shipId }, payload, idempotencyKey: payload }),
  );
  let deliveryId = '';
  for (let claim = 1; claim < UNDELIVERABLE_AT_CLAIM; claim += 1) {
    const { deliveries } = receivedSchema.parse(await to.call('receive', {}));
    expect(deliveries.map((delivery) => delivery.messageId)).toEqual([messageId]);
    deliveryId = deliveries[0]?.deliveryId ?? '';
  }
  await to.call('receive', {});
  return deliveryId;
}

async function signedInPage(): Promise<Page> {
  clock.advance(SIGN_IN_WINDOW_MS);
  const context = await browser.newContext({ baseURL: web.url });
  contexts.push(context);
  const page = await context.newPage();
  await signIn(page, OPERATOR);
  await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
  return page;
}

function attentionRow(page: Page, deliveryId: string) {
  return page.locator(`[data-testid="attention-row"][data-delivery-id="${deliveryId}"]:visible`);
}

describe('Needs attention', () => {
  it('shows an undeliverable delivery live with its count, and resends it: a new message reaches the ship', async () => {
    const builder = await crewedOverRest({ name: 'builder-core', type: 'builder' });
    const tester = await crewedOverRest({ name: 'tester-01', type: 'tester' });
    const page = await signedInPage();
    const navigation = page.getByTestId('nav-attention');
    await navigation.waitFor();

    const deliveryId = await undeliverable({ from: builder, to: tester, payload: '{"run":"e2e","ref":"pr-320"}' });

    await navigation.getByText('1').waitFor({ timeout: LIVE_TIMEOUT_MS });
    await navigation.click();
    await page.waitForURL(`${web.url}/needs-attention`);
    await page.getByRole('heading', { name: 'Needs attention' }).waitFor();
    const row = attentionRow(page, deliveryId);
    await row.getByText('{"run":"e2e","ref":"pr-320"}').waitFor();
    await row.getByText('Received 5 times, never acknowledged.').waitFor();

    await row.getByTestId('attention-resend').click();

    await page.getByText('Message resent').waitFor();
    await row.waitFor({ state: 'detached' });
    await page.getByTestId('attention-empty').waitFor();
    const { deliveries } = receivedSchema.parse(await tester.call('receive', {}));
    const resent = await database.message.findFirstOrThrow({ where: { resendOfMessageId: { not: null } } });
    expect(deliveries.map((delivery) => delivery.messageId)).toEqual([resent.id]);
    expect(resent.senderShipId).toBe(builder.shipId);
  });

  it('dismisses an undeliverable delivery: it leaves the list and stays in history as dismissed', async () => {
    const reviewer = await crewedOverRest({ name: 'reviewer-02', type: 'reviewer' });
    const planner = await crewedOverRest({ name: 'planner', type: 'planner' });
    const deliveryId = await undeliverable({ from: planner, to: reviewer, payload: 'Pause all reviews until 15:00.' });
    const page = await signedInPage();
    await page.goto('/needs-attention');
    const row = attentionRow(page, deliveryId);
    await row.getByText('Pause all reviews until 15:00.').waitFor();

    await row.getByTestId('attention-dismiss').click();

    await page.getByText('Delivery dismissed').waitFor();
    await row.waitFor({ state: 'detached' });
    await expect(database.delivery.findUniqueOrThrow({ where: { id: deliveryId } })).resolves.toMatchObject({
      state: 'dismissed',
    });
  });
});
