import { ANSWER_CONTENT_TYPE, QUESTION_CONTENT_TYPE, REPLACEMENT_CONTENT_TYPE, WITHDRAWAL_CONTENT_TYPE } from '@aeolus-fleet/common';
import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createPrismaClient, type PrismaClient } from '../packages/core/src/adapters/prisma/client.js';
import { createApp } from '../packages/core/src/app.js';
import type { Caller } from '../packages/core/src/domain/shared/caller.js';
import { createUseCases, type UseCases } from '../packages/core/src/wiring.js';
import { FLEET_URL, OPERATOR, operatorCaller, secretOf } from '../packages/core/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../packages/core/test/support/database.js';
import { createTestClock } from '../packages/core/test/support/postgres-core.js';
import { unwrap } from '../packages/core/test/support/result.js';
import { signIn } from './support/console.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';
import { newKey } from '../packages/core/test/support/keys.js';

// Questions to argo, end to end (decision 0038): a ship's session asks argo a
// question over the REST API, it shows live on Questions with its count and
// not in the inbox, the operator picks an option with a note, and the asking
// ship receives the answer as a reply to its question, which shows answered.
// The asking ship withdraws or replaces a question by its uuid; it shows
// stale, can't be answered, and links to its replacement.

const clock = createTestClock('2026-10-11T09:00:00.000Z');
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
  call(operation: 'send' | 'receive' | 'ack', body: Record<string, unknown>): Promise<unknown>;
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
const receivedSchema = z.object({
  deliveries: z.array(z.object({ messageId: z.string(), contentType: z.string(), payload: z.string(), inReplyTo: z.string().nullable() })),
});

async function signedInPage(): Promise<Page> {
  clock.advance(SIGN_IN_WINDOW_MS);
  const context = await browser.newContext({ baseURL: web.url });
  contexts.push(context);
  const page = await context.newPage();
  await signIn(page, OPERATOR);
  await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
  return page;
}

const QUESTION = {
  id: '3f1c2a9e-7b4d-4e8a-9c1f-2d6b8e0a5c47',
  title: 'Which port does the console use in development?',
  context: 'docs/architecture.md says 3000 and the README says 4000.',
  options: [
    { key: 1, label: 'Keep 3000', detail: 'What the console uses now.' },
    { key: 2, label: 'Move to 4000', detail: 'Frees 3000 for core.' },
  ],
  pick: { option: 2, why: 'Fewest changes.' },
};

/** The visible one of a test id: the desktop and phone layouts both render it. */
function visible(page: Page, testId: string) {
  return page.locator(`[data-testid="${testId}"]:visible`);
}

function questionRow(page: Page, title: string) {
  return page.locator('[data-testid="questions-row"]:visible').filter({ hasText: title });
}

describe('questions to argo', () => {
  it('shows a question live with its count, apart from the inbox; the answer reaches the asking ship as a reply, and it shows answered', async () => {
    const implementer = await crewedOverRest({ name: 'implementer-b', type: 'implementer' });
    const page = await signedInPage();
    const navigation = page.getByTestId('nav-questions');
    await navigation.waitFor();

    const asked = sentSchema.parse(
      await implementer.call('send', {
        selector: { kind: 'ship', shipId: argo.shipId },
        contentType: QUESTION_CONTENT_TYPE,
        payload: JSON.stringify(QUESTION),
        idempotencyKey: 'ask-port',
      }),
    ).messageId;

    await navigation.getByText('1').waitFor({ timeout: LIVE_TIMEOUT_MS });
    await expect(page.getByTestId('nav-inbox-count').count()).resolves.toBe(0);
    await navigation.click();
    await page.waitForURL(`${web.url}/questions`);
    await questionRow(page, QUESTION.title).click();
    const question = visible(page, 'questions-question');
    await question.getByText('Why: Fewest changes.').waitFor();
    await question.getByTestId('questions-option-2').getByText('2. Move to 4000').click();
    await visible(page, 'questions-note').fill('Tell core first.');
    await visible(page, 'questions-send').click();

    await questionRow(page, QUESTION.title).waitFor({ state: 'detached' });
    await page.goto('/questions?filter=answered');
    await questionRow(page, QUESTION.title).click();
    await visible(page, 'questions-answered').getByText('2. Move to 4000', { exact: false }).waitFor();
    const { deliveries } = receivedSchema.parse(await implementer.call('receive', {}));
    expect(deliveries).toEqual([expect.objectContaining({ contentType: ANSWER_CONTENT_TYPE, inReplyTo: asked })]);
    expect(JSON.parse(deliveries[0]?.payload ?? '')).toEqual({ questionId: QUESTION.id, option: 2, note: 'Tell core first.' });
    await expect(page.getByTestId('nav-questions-count').count()).resolves.toBe(0);
    await page.goto('/inbox?filter=all');
    await page.locator('[data-testid="inbox-empty"]:visible').waitFor();
  });

  it('answers with a note alone, asking for more context', async () => {
    const implementer = await crewedOverRest({ name: 'implementer-c', type: 'implementer' });
    const question = { ...QUESTION, id: '0a7d3c1e-2b4f-4c6a-8e9d-1f3b5a7c9e2d', title: 'Drop legacy_runs in migration 0042?' };
    await implementer.call('send', {
      selector: { kind: 'ship', shipId: argo.shipId },
      contentType: QUESTION_CONTENT_TYPE,
      payload: JSON.stringify(question),
      idempotencyKey: 'ask-migration',
    });
    const page = await signedInPage();
    await page.goto('/questions');
    await questionRow(page, question.title).click();

    await visible(page, 'questions-note').fill('Who still reads it?');
    await visible(page, 'questions-send').click();

    await questionRow(page, question.title).waitFor({ state: 'detached' });
    await page.goto('/questions?filter=answered');
    await questionRow(page, question.title).click();
    await visible(page, 'questions-answered').getByText('Who still reads it?').waitFor();
    const { deliveries } = receivedSchema.parse(await implementer.call('receive', {}));
    expect(JSON.parse(deliveries[0]?.payload ?? '')).toEqual({ questionId: question.id, note: 'Who still reads it?' });
  });

  it('shows a question the asker withdrew or replaced as stale, not answerable, with the replacement linked and answerable', async () => {
    const implementer = await crewedOverRest({ name: 'implementer-d', type: 'implementer' });
    const withdrawn = { ...QUESTION, id: '5c8e1a3b-6d2f-4b7a-9e0c-3a5d7f9b1c2e', title: 'Rename the inbox filter?' };
    const replaced = { ...QUESTION, id: '7e2a4c6b-8d0f-4a1c-b3e5-6f8a0c2e4b7d', title: 'Which port for the preview server?' };
    const replacement = { ...QUESTION, id: '1d3f5b7a-9c2e-4f6a-8b0d-2e4c6a8f0b3d', title: 'Which port for the preview server, now that core moved?' };
    const toArgo = { kind: 'ship', shipId: argo.shipId };
    for (const question of [withdrawn, replaced]) {
      await implementer.call('send', { selector: toArgo, contentType: QUESTION_CONTENT_TYPE, payload: JSON.stringify(question), idempotencyKey: `ask-${question.id}` });
    }
    const page = await signedInPage();
    await page.goto('/questions');
    await questionRow(page, withdrawn.title).waitFor();
    await questionRow(page, replaced.title).waitFor();

    await implementer.call('send', {
      selector: toArgo,
      contentType: WITHDRAWAL_CONTENT_TYPE,
      payload: JSON.stringify({ questionId: withdrawn.id }),
      idempotencyKey: 'withdraw-rename',
    });
    await implementer.call('send', {
      selector: toArgo,
      contentType: REPLACEMENT_CONTENT_TYPE,
      payload: JSON.stringify({ questionId: replaced.id, question: replacement }),
      idempotencyKey: 'replace-preview-port',
    });

    await questionRow(page, withdrawn.title).waitFor({ state: 'detached', timeout: LIVE_TIMEOUT_MS });
    await questionRow(page, replaced.title).waitFor({ state: 'detached' });
    await questionRow(page, replacement.title).waitFor();
    await page.goto('/questions?filter=stale');
    await questionRow(page, withdrawn.title).click();
    await visible(page, 'questions-stale').getByText('Withdrawn by implementer-d', { exact: false }).waitFor();
    await expect(visible(page, 'questions-send').count()).resolves.toBe(0);

    await questionRow(page, replaced.title).click();
    await visible(page, 'questions-stale').getByText('Replaced by implementer-d', { exact: false }).waitFor();
    await expect(visible(page, 'questions-send').count()).resolves.toBe(0);
    await visible(page, 'questions-replacement').getByText(replacement.title).click();
    await page.waitForURL(/filter=all/);
    const opened = visible(page, 'questions-question');
    await opened.getByRole('heading', { name: replacement.title }).waitFor();
    await visible(page, 'questions-replaces').getByText(replaced.title).waitFor();

    await opened.getByTestId('questions-option-1').getByText('1. Keep 3000').click();
    await visible(page, 'questions-send').click();
    await visible(page, 'questions-answered').waitFor();
    const { deliveries } = receivedSchema.parse(await implementer.call('receive', {}));
    expect(deliveries.map(({ payload }): unknown => JSON.parse(payload))).toEqual([{ questionId: replacement.id, option: 1 }]);
    await page.goto('/inbox?filter=all');
    await page.locator('[data-testid="inbox-empty"]:visible').waitFor();
  });
});
