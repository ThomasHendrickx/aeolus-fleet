import { idSchema, type DeliveryId } from '@aeolus-fleet/common';
import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createPrismaClient, type PrismaClient } from '../packages/core/src/adapters/prisma/client.js';
import { createApp } from '../packages/core/src/app.js';
import type { Caller, Crew } from '../packages/core/src/domain/shared/caller.js';
import { createUseCases, type UseCases } from '../packages/core/src/wiring.js';
import { FLEET_URL, OPERATOR, operatorCaller, secretOf } from '../packages/core/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../packages/core/src/testing/database.js';
import { createTestClock } from '../packages/core/test/support/postgres-core.js';
import { unwrap } from '../packages/core/src/testing/result.js';
import { signIn } from './support/console.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';
import { newKey } from '../packages/core/src/testing/keys.js';

// Health, end to end (#304): a ship's session receives a message five times
// over the REST API without acknowledging it, the delivery shows on Health
// live with the stuck count in the navigation, and the operator opens the
// cause and resends one (a new message reaches the ship) and dismisses
// another. A delivery no ship can take clears live once a ship of its type
// is commissioned, and one a pushed crew reports not handled shows on its
// ship's page.

const clock = createTestClock('2026-10-01T09:00:00.000Z');
/** A live change shows within this. */
const LIVE_TIMEOUT_MS = 20_000;
/** A receive returns at once when it has deliveries; an empty one waits no longer than this. */
const RECEIVE_WAIT_MS = 500;
/** The attempt that makes a delivery never acknowledged undeliverable. */
const UNDELIVERABLE_AT_ATTEMPT = 5;
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
  useCases = createUseCases({ prisma: database, clock });
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

/** The sender's message to the receiver, which the receiver's session takes five times without acknowledging it. */
async function undeliverable(message: { from: Session; to: Session; payload: string }): Promise<string> {
  const { from, to, payload } = message;
  const { messageId } = sentSchema.parse(
    await from.call('send', { selector: { kind: 'ship', shipId: to.shipId }, payload, idempotencyKey: payload }),
  );
  let deliveryId = '';
  for (let claim = 1; claim < UNDELIVERABLE_AT_ATTEMPT; claim += 1) {
    const { deliveries } = receivedSchema.parse(await to.call('receive', {}));
    expect(deliveries.map((delivery) => delivery.messageId)).toEqual([messageId]);
    deliveryId = deliveries[0]?.deliveryId ?? '';
  }
  await to.call('receive', {});
  return deliveryId;
}

/** A ship crewed on the core, as its pushed crew's computer side calls it. */
async function crewedOverCore(ship: { name: string; type: string }): Promise<Crew> {
  const { shipId, secret } = unwrap(await useCases.commissionShip(argo, { ...ship, idempotencyKey: newKey() }));
  const { crewToken } = unwrap(await useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'DEVICE' }, harness: 'claude-code' }));
  return unwrap(await useCases.authenticate.byCrewToken(crewToken));
}

/**
 * argo's message to the crew, which its computer side takes, hands over and
 * confirms, hands once more after the turn died, and reports not handled when
 * that turn died too.
 */
async function notHandled(message: { to: Crew; payload: string }): Promise<DeliveryId> {
  const { to, payload } = message;
  const { messageId } = unwrap(await useCases.sendMessage(argo, { selector: { kind: 'ship', shipId: to.shipId }, payload, idempotencyKey: newKey() }));
  const deliveryId = idSchema('delivery').parse((await database.delivery.findFirstOrThrow({ where: { messageId } })).id);
  unwrap(await useCases.pushReceiveDeliveries(to, {}));
  unwrap(await useCases.handOverDelivery(to, { deliveryId, handOverNumber: 1 }));
  unwrap(await useCases.acknowledgeDelivery(to, { deliveryId }));
  unwrap(await useCases.handOverDelivery(to, { deliveryId, handOverNumber: 2, isOnceMore: true }));
  unwrap(await useCases.reportNotHandled(to, { deliveryId }));
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

function stuckRow(page: Page, deliveryId: string) {
  return page.locator(`[data-testid="drilldown-row"][data-delivery-id="${deliveryId}"]:visible`);
}

describe('Health', () => {
  it('shows an undeliverable delivery live with the stuck count, and resends it from its cause: a new message reaches the ship', async () => {
    const builder = await crewedOverRest({ name: 'builder-core', type: 'builder' });
    const tester = await crewedOverRest({ name: 'tester-01', type: 'tester' });
    const page = await signedInPage();
    const navigation = page.getByTestId('nav-health');
    await navigation.waitFor();

    const deliveryId = await undeliverable({ from: builder, to: tester, payload: '{"run":"e2e","ref":"pr-320"}' });

    await navigation.getByText('1').waitFor({ timeout: LIVE_TIMEOUT_MS });
    await navigation.click();
    await page.waitForURL(`${web.url}/fleet-health`);
    await page.getByRole('heading', { name: 'Health' }).first().waitFor();
    const cause = page.locator('[data-testid="health-cause"][data-cause="undeliverable"]');
    await cause.getByText('tester-01').first().waitFor({ timeout: LIVE_TIMEOUT_MS });
    await cause.getByTestId('health-cause-open').click();
    await page.waitForURL(`${web.url}/fleet-health/undeliverable`);
    const row = stuckRow(page, deliveryId);
    await row.getByText('{"run":"e2e","ref":"pr-320"}').waitFor();

    await row.getByTestId('drilldown-resend').click();

    await page.getByText('Message resent').waitFor();
    await row.waitFor({ state: 'detached', timeout: LIVE_TIMEOUT_MS });
    await page.getByText('No delivery is stuck for this cause now.').waitFor();
    const { deliveries } = receivedSchema.parse(await tester.call('receive', {}));
    const resent = await database.message.findFirstOrThrow({ where: { resendOfMessageId: { not: null } } });
    expect(deliveries.map((delivery) => delivery.messageId)).toEqual([resent.id]);
    expect(resent.senderShipId).toBe(builder.shipId);
  });

  it('dismisses an undeliverable delivery from its cause: it leaves the list and stays in history as dismissed', async () => {
    const reviewer = await crewedOverRest({ name: 'reviewer-02', type: 'reviewer' });
    const planner = await crewedOverRest({ name: 'planner', type: 'planner' });
    const deliveryId = await undeliverable({ from: planner, to: reviewer, payload: 'Pause all reviews until 15:00.' });
    const page = await signedInPage();
    await page.goto('/fleet-health/undeliverable');
    const row = stuckRow(page, deliveryId);
    await row.getByText('Pause all reviews until 15:00.').waitFor();

    await row.getByTestId('drilldown-dismiss').click();

    await page.getByText('Delivery dismissed').waitFor();
    await row.waitFor({ state: 'detached', timeout: LIVE_TIMEOUT_MS });
    await expect(database.delivery.findUniqueOrThrow({ where: { id: deliveryId } })).resolves.toMatchObject({
      state: 'dismissed',
    });
  });

  it('shows a delivery no ship can take once the last ship of its type retires, and clears it live once a ship of the type is commissioned', async () => {
    const mapper = unwrap(await useCases.commissionShip(argo, { name: 'mapper-01', type: 'mapper', idempotencyKey: newKey() }));
    const { messageId } = unwrap(await useCases.sendMessage(argo, { selector: { kind: 'type', type: 'mapper' }, payload: 'Map the harbour.', idempotencyKey: newKey() }));
    unwrap(await useCases.retireShip(argo, { shipId: mapper.shipId }));
    const page = await signedInPage();
    await page.goto('/fleet-health');
    const cause = page.locator('[data-testid="health-cause"][data-cause="noShipCanTake"]');
    await cause.getByText('mapper', { exact: true }).first().waitFor();
    await cause.getByTestId('health-next-step').getByText('Commission a mapper').waitFor();

    unwrap(await useCases.commissionShip(argo, { name: 'mapper-02', type: 'mapper', idempotencyKey: newKey() }));

    await cause.waitFor({ state: 'detached', timeout: LIVE_TIMEOUT_MS });
    await expect(database.delivery.findFirstOrThrow({ where: { messageId } })).resolves.toMatchObject({ state: 'pending' });
  });

  it('shows a not handled delivery live on its ship page, not on Health', async () => {
    const surveyor = await crewedOverCore({ name: 'surveyor-01', type: 'surveyor' });
    const page = await signedInPage();
    await page.goto(`/ships/${surveyor.shipId}`);
    await page.getByRole('heading', { name: 'surveyor-01' }).first().waitFor();

    const deliveryId = await notHandled({ to: surveyor, payload: 'Survey the bay.' });

    const section = page.getByTestId('ship-not-handled');
    await section.getByRole('heading', { name: 'Not handled (1)' }).waitFor({ timeout: LIVE_TIMEOUT_MS });
    const row = section.locator(`[data-testid="attention-row"][data-delivery-id="${deliveryId}"]:visible`);
    await row.getByText('Survey the bay.').waitFor();
    await row.getByTestId('attention-resend').waitFor();
    await row.getByTestId('attention-dismiss').waitFor();
  });

  it('opens Health from an old Needs attention link', async () => {
    const page = await signedInPage();

    await page.goto('/needs-attention');

    await page.waitForURL(`${web.url}/fleet-health`);
  });
});
