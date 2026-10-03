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

// The operator inbox and Compose, end to end: a ship's session sends argo a
// message over the REST API, it shows in the inbox live with its count, the
// operator opens it (read), replies (the ship receives the reply, the message
// is done) and marks another done; and composes a message to a ship, which
// its session receives. On desktop, Cmd+Enter or Ctrl+Enter sends from both,
// Enter alone is a newline, and the Send button hints the platform's keys.

const clock = createTestClock('2026-10-01T09:00:00.000Z');
/** A live change shows within this. */
const LIVE_TIMEOUT_MS = 20_000;
/** A receive returns at once when it has deliveries; an empty one waits no longer than this. */
const RECEIVE_WAIT_MS = 500;
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
  call(operation: 'send' | 'receive' | 'ack', body: Record<string, unknown>): Promise<unknown>;
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
const receivedSchema = z.object({
  deliveries: z.array(z.object({ messageId: z.string(), payload: z.string(), inReplyTo: z.string().nullable() })),
});

const MAC_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const WINDOWS_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

async function signedInPage(userAgent?: string): Promise<Page> {
  clock.advance(SIGN_IN_WINDOW_MS);
  const context = await browser.newContext({ baseURL: web.url, ...(userAgent === undefined ? {} : { userAgent }) });
  contexts.push(context);
  const page = await context.newPage();
  await signIn(page, OPERATOR);
  await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
  return page;
}

/** The ship's message to argo; answers its id. */
async function toArgo(from: Session, payload: string): Promise<string> {
  return sentSchema.parse(
    await from.call('send', { selector: { kind: 'ship', shipId: argo.shipId }, payload, idempotencyKey: payload }),
  ).messageId;
}

/** The visible one of a test id: the desktop and phone layouts both render it. */
function visible(page: Page, testId: string) {
  return page.locator(`[data-testid="${testId}"]:visible`);
}

function inboxRow(page: Page, payload: string) {
  return page.locator('[data-testid="inbox-row"]:visible').filter({ hasText: payload });
}

describe('the operator inbox', () => {
  it('shows a message to argo live with its count; opening reads it, and a reply reaches the sender and marks it done', async () => {
    const captain = await crewedOverRest({ name: 'release-captain', type: 'release' });
    const page = await signedInPage();
    const navigation = page.getByTestId('nav-inbox');
    await navigation.waitFor();

    const asked = await toArgo(captain, 'Release 2.14 is staged. Promote to production?');

    await navigation.getByText('1').waitFor({ timeout: LIVE_TIMEOUT_MS });
    await navigation.click();
    await page.waitForURL(`${web.url}/inbox`);
    await inboxRow(page, 'Promote to production?').click();
    await visible(page, 'inbox-reply').fill('go');
    await expect
      .poll(async () => (await database.delivery.findFirstOrThrow({ where: { messageId: asked } })).readAt)
      .not.toBeNull();

    await visible(page, 'inbox-reply-send').click();

    await inboxRow(page, 'Promote to production?').waitFor({ state: 'detached' });
    const { deliveries } = receivedSchema.parse(await captain.call('receive', {}));
    expect(deliveries).toEqual([expect.objectContaining({ payload: 'go', inReplyTo: asked })]);
    await page.goto('/inbox?filter=done');
    await inboxRow(page, 'Promote to production?').click();
    await visible(page, 'inbox-done-notice').getByText('when you replied', { exact: false }).waitFor();
  });

  it('marks a message done without a reply', async () => {
    const tester = await crewedOverRest({ name: 'tester-01', type: 'tester' });
    const asked = await toArgo(tester, 'checkout-e2e failed 3 of 5 runs since 12:00.');
    const page = await signedInPage();
    await page.goto('/inbox');
    await inboxRow(page, 'checkout-e2e failed').click();

    await visible(page, 'inbox-mark-done').click();

    await inboxRow(page, 'checkout-e2e failed').waitFor({ state: 'detached' });
    await expect(database.delivery.findFirstOrThrow({ where: { messageId: asked } })).resolves.toMatchObject({
      state: 'acknowledged',
    });
  });
});

describe('Compose', () => {
  it('sends a message as argo to a ship picked by name, which its session receives', async () => {
    const reviewer = await crewedOverRest({ name: 'reviewer-01', type: 'reviewer' });
    const page = await signedInPage();

    await page.getByTestId('header-compose').click();
    const dialog = page.getByTestId('compose-dialog');
    await dialog.getByTestId('compose-ship').fill('revi');
    await page.getByRole('option', { name: /reviewer-01/ }).click();
    await dialog.getByTestId('compose-payload').fill('Pause all reviews until 15:00.');
    await dialog.getByTestId('compose-send').click();

    await dialog.waitFor({ state: 'hidden' });
    const { deliveries } = receivedSchema.parse(await reviewer.call('receive', {}));
    expect(deliveries).toEqual([expect.objectContaining({ payload: 'Pause all reviews until 15:00.', inReplyTo: null })]);
  });
});

describe('the Compose recipient', () => {
  it('turns an uppercase search into lowercase and finds the ship by its name', async () => {
    await crewedOverRest({ name: 'harbour:pilot', type: 'harbour:crew' });
    const page = await signedInPage();
    await page.getByTestId('header-compose').click();
    const dialog = page.getByTestId('compose-dialog');

    await dialog.getByTestId('compose-ship').fill('HARBOUR:PI');

    await expect(dialog.getByTestId('compose-ship').inputValue()).resolves.toBe('harbour:pi');
    await page.getByRole('option', { name: /harbour:pilot/ }).waitFor();
  });
});

describe('the send shortcut', () => {
  it('sends a composed message on Cmd+Enter on a Mac, where Enter alone is a newline and Send hints ⌘↵', async () => {
    const reviewer = await crewedOverRest({ name: 'reviewer-02', type: 'reviewer' });
    const page = await signedInPage(MAC_USER_AGENT);
    await page.getByTestId('header-compose').click();
    const dialog = page.getByTestId('compose-dialog');
    await dialog.getByTestId('compose-ship').fill('reviewer-02');
    await page.getByRole('option', { name: /reviewer-02/ }).click();
    const payload = dialog.getByTestId('compose-payload');
    await payload.fill('Review PR 75.');

    await payload.press('Enter');
    await payload.pressSequentially('Then PR 76.');
    await expect.poll(() => dialog.getByTestId('send-shortcut-hint').textContent()).toBe('⌘↵');
    await payload.press('Meta+Enter');

    await dialog.waitFor({ state: 'hidden' });
    const { deliveries } = receivedSchema.parse(await reviewer.call('receive', {}));
    expect(deliveries).toEqual([expect.objectContaining({ payload: 'Review PR 75.\nThen PR 76.' })]);
  });

  it('sends a reply on Ctrl+Enter elsewhere, where Send reply hints Ctrl ↵', async () => {
    const captain = await crewedOverRest({ name: 'release-captain-02', type: 'release' });
    const asked = await toArgo(captain, 'Release 2.15 is staged. Promote?');
    const page = await signedInPage(WINDOWS_USER_AGENT);
    await page.goto('/inbox');
    await inboxRow(page, 'Release 2.15 is staged.').click();
    const reply = visible(page, 'inbox-reply');
    await reply.fill('go');

    await expect.poll(() => visible(page, 'inbox-reply-send').getByTestId('send-shortcut-hint').textContent()).toBe('Ctrl ↵');
    await reply.press('Control+Enter');

    await inboxRow(page, 'Release 2.15 is staged.').waitFor({ state: 'detached' });
    const { deliveries } = receivedSchema.parse(await captain.call('receive', {}));
    expect(deliveries).toEqual([expect.objectContaining({ payload: 'go', inReplyTo: asked })]);
  });
});
