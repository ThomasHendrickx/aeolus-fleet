import { ANSWER_CONTENT_TYPE, QUESTION_CONTENT_TYPE, REPLACEMENT_CONTENT_TYPE, WITHDRAWAL_CONTENT_TYPE } from '@aeolus-fleet/common';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

// Questions to argo, end to end (decision 0038, #849): a ship's session asks
// argo a question over the REST API, it shows live on top of the inbox with
// its count, the asker's pick chosen, the operator answers it with a note, and
// the asking ship receives the answer as a reply to its question, which shows
// answered under Done.
// The asking ship withdraws or replaces a question by its uuid; it shows
// stale, can't be answered, and links to its replacement. A ship crewed with
// the aeolus plugin does all of it with aeolus-ask.sh (#684).

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
/** Throwaway folders of plugin-crewed ships: their home, folder and plugin data. */
const pluginFolders: string[] = [];

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
  for (const folder of pluginFolders) {
    rmSync(folder, { recursive: true, force: true });
  }
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

const PLUGIN_SCRIPTS = fileURLToPath(new URL('../plugins/aeolus/scripts/', import.meta.url));

/** A ship's session crewed with the aeolus plugin: it runs the plugin's scripts in its folder. */
type PluginSession = (script: string, args: string[]) => Promise<string>;

async function crewedWithPlugin(ship: { name: string; type: string }): Promise<PluginSession> {
  const { shipId, secret } = unwrap(await useCases.commissionShip(argo, { ...ship, idempotencyKey: newKey() }));
  const [home, folder, data] = ['home', 'folder', 'data'].map((name) => mkdtempSync(join(tmpdir(), `aeolus-ask-${name}-`)));
  pluginFolders.push(home ?? '', folder ?? '', data ?? '');
  const session: PluginSession = (script, args) => {
    const child = spawn('bash', [join(PLUGIN_SCRIPTS, script), ...args], {
      env: { ...process.env, HOME: home, AEOLUS_FOLDER: folder, AEOLUS_DATA: data },
    });
    child.stdin.end();
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    return new Promise((resolve, reject) => {
      child.on('close', (status) => {
        if (status === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`${script} exited ${String(status)}: ${stdout}`));
        }
      });
    });
  };
  await session('aeolus-fleet.sh', ['register', serverUrl, shipId, secretOf(secret), 'DEVICE']);
  return session;
}

/** The question's uuid and message aeolus-ask.sh says it asked. */
function asked(output: string): { questionId: string; messageId: string } {
  const said = /question ([0-9a-f-]{36}) \(message (msg_\w+)\)/.exec(output);
  return { questionId: said?.[1] ?? '', messageId: said?.[2] ?? '' };
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
  return page.locator('[data-testid="inbox-question-row"]:visible').filter({ hasText: title });
}

describe('questions to argo', () => {
  it('shows a question live on top of the inbox with its count and the pick chosen; the answer reaches the asking ship as a reply, and it shows answered', async () => {
    const implementer = await crewedOverRest({ name: 'implementer-b', type: 'implementer' });
    const page = await signedInPage();
    const navigation = page.getByTestId('nav-inbox');
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
    await navigation.click();
    await page.waitForURL(`${web.url}/inbox`);
    await questionRow(page, QUESTION.title).click();
    const question = visible(page, 'inbox-question');
    await question.getByText('Fewest changes.').waitFor();
    await expect.poll(() => visible(page, 'inbox-answer').textContent()).toContain('Answer: Move to 4000');
    await visible(page, 'inbox-note').fill('Tell core first.');
    await expect.poll(() => visible(page, 'inbox-answer').textContent()).toContain('Answer: Move to 4000, with note');
    await visible(page, 'inbox-answer').click();

    await questionRow(page, QUESTION.title).waitFor({ state: 'detached' });
    await visible(page, 'inbox-answered').getByText('2. Move to 4000', { exact: false }).waitFor();
    const { deliveries } = receivedSchema.parse(await implementer.call('receive', {}));
    expect(deliveries).toEqual([expect.objectContaining({ contentType: ANSWER_CONTENT_TYPE, inReplyTo: asked })]);
    expect(JSON.parse(deliveries[0]?.payload ?? '')).toEqual({ questionId: QUESTION.id, option: 2, note: 'Tell core first.' });
    await expect(page.getByTestId('nav-inbox-count').count()).resolves.toBe(0);
    await page.goto('/inbox?filter=done');
    await questionRow(page, QUESTION.title).click();
    await visible(page, 'inbox-answered').waitFor();
    await page.goto('/inbox');
    await page.locator('[data-testid="inbox-empty"]:visible').waitFor();
  });

  it('answers with a note alone once the pick is taken back, asking for more context', async () => {
    const implementer = await crewedOverRest({ name: 'implementer-c', type: 'implementer' });
    const question = { ...QUESTION, id: '0a7d3c1e-2b4f-4c6a-8e9d-1f3b5a7c9e2d', title: 'Drop legacy_runs in migration 0042?' };
    await implementer.call('send', {
      selector: { kind: 'ship', shipId: argo.shipId },
      contentType: QUESTION_CONTENT_TYPE,
      payload: JSON.stringify(question),
      idempotencyKey: 'ask-migration',
    });
    const page = await signedInPage();
    await page.goto('/inbox');
    await questionRow(page, question.title).click();

    await visible(page, 'inbox-question').getByTestId('inbox-option-2').getByText('Move to 4000').click();
    await visible(page, 'inbox-note').fill('Who still reads it?');
    await expect.poll(() => visible(page, 'inbox-answer').textContent()).toContain('Send note');
    await visible(page, 'inbox-answer').click();

    await visible(page, 'inbox-answered').getByText('Who still reads it?').waitFor();
    const { deliveries } = receivedSchema.parse(await implementer.call('receive', {}));
    expect(JSON.parse(deliveries[0]?.payload ?? '')).toEqual({ questionId: question.id, note: 'Who still reads it?' });
  });

  it('shows a question the asker withdrew or replaced as stale under Done, not answerable, with the replacement linked and answerable', async () => {
    const implementer = await crewedOverRest({ name: 'implementer-d', type: 'implementer' });
    const withdrawn = { ...QUESTION, id: '5c8e1a3b-6d2f-4b7a-9e0c-3a5d7f9b1c2e', title: 'Rename the inbox filter?' };
    const replaced = { ...QUESTION, id: '7e2a4c6b-8d0f-4a1c-b3e5-6f8a0c2e4b7d', title: 'Which port for the preview server?' };
    const replacement = { ...QUESTION, id: '1d3f5b7a-9c2e-4f6a-8b0d-2e4c6a8f0b3d', title: 'Which port for the preview server, now that core moved?' };
    const toArgo = { kind: 'ship', shipId: argo.shipId };
    for (const question of [withdrawn, replaced]) {
      await implementer.call('send', { selector: toArgo, contentType: QUESTION_CONTENT_TYPE, payload: JSON.stringify(question), idempotencyKey: `ask-${question.id}` });
    }
    const page = await signedInPage();
    await page.goto('/inbox');
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
    await expect(page.locator('[data-testid="inbox-row"]:visible').count()).resolves.toBe(0);
    await page.goto('/inbox?filter=done');
    await questionRow(page, withdrawn.title).click();
    await visible(page, 'inbox-stale').getByText('Withdrawn by implementer-d', { exact: false }).waitFor();
    await expect(visible(page, 'inbox-answer').count()).resolves.toBe(0);

    await questionRow(page, replaced.title).click();
    await visible(page, 'inbox-stale').getByText('Replaced by implementer-d', { exact: false }).waitFor();
    await expect(visible(page, 'inbox-answer').count()).resolves.toBe(0);
    await visible(page, 'inbox-replacement').getByText(replacement.title).click();
    const opened = visible(page, 'inbox-question');
    await opened.getByRole('heading', { name: replacement.title }).waitFor();
    await visible(page, 'inbox-replaces').getByText(replaced.title).waitFor();

    await opened.getByTestId('inbox-option-1').getByText('Keep 3000').click();
    await visible(page, 'inbox-answer').click();
    await visible(page, 'inbox-answered').waitFor();
    const { deliveries } = receivedSchema.parse(await implementer.call('receive', {}));
    expect(deliveries.map(({ payload }): unknown => JSON.parse(payload))).toEqual([{ questionId: replacement.id, option: 1 }]);
    await page.goto('/inbox');
    await page.locator('[data-testid="inbox-empty"]:visible').waitFor();
  });

  it('shows a question a ship crewed with the plugin asks, withdraws and replaces with aeolus-ask.sh, and the ship receives the answer as a reply (#684)', async () => {
    const implementer = await crewedWithPlugin({ name: 'implementer-e', type: 'implementer' });
    const model = ['--model', 'claude-opus-5-5'];
    const aQuestion = (title: string) => [
      '--title', title,
      '--context', 'docs/architecture.md says 3000 and the README says 4000.',
      '--option', 'Keep 3000', 'What the console uses now.',
      '--option', 'Move to 4000', 'Frees 3000 for core.',
      '--pick', '2', 'Fewest changes.',
      ...model,
    ];
    const page = await signedInPage();
    await page.goto('/inbox');

    const withdrawn = asked(await implementer('aeolus-ask.sh', ['ask', ...aQuestion('Rename the plugin helper?')]));
    const replaced = asked(await implementer('aeolus-ask.sh', ['ask', ...aQuestion('Which port for the docs server?')]));
    await questionRow(page, 'Rename the plugin helper?').waitFor({ timeout: LIVE_TIMEOUT_MS });
    await questionRow(page, 'Which port for the docs server?').click();
    await visible(page, 'inbox-question').getByText('Fewest changes.').waitFor();
    await visible(page, 'inbox-question').getByTestId('inbox-option-2').getByText('Move to 4000').waitFor();

    await implementer('aeolus-ask.sh', ['withdraw', withdrawn.questionId, ...model]);
    const replacement = asked(await implementer('aeolus-ask.sh', ['replace', replaced.questionId, ...aQuestion('Which port for the docs server, now that core moved?')]));

    await questionRow(page, 'Rename the plugin helper?').waitFor({ state: 'detached', timeout: LIVE_TIMEOUT_MS });
    await questionRow(page, 'Which port for the docs server?').waitFor({ state: 'detached' });
    await page.goto('/inbox?filter=done');
    await questionRow(page, 'Rename the plugin helper?').click();
    await visible(page, 'inbox-stale').getByText('Withdrawn by implementer-e', { exact: false }).waitFor();
    await questionRow(page, 'Which port for the docs server?').click();
    await visible(page, 'inbox-stale').getByText('Replaced by implementer-e', { exact: false }).waitFor();
    await visible(page, 'inbox-replacement').getByText('Which port for the docs server, now that core moved?').click();
    await visible(page, 'inbox-question').getByRole('heading', { name: 'Which port for the docs server, now that core moved?' }).waitFor();
    await visible(page, 'inbox-answer').click();
    await visible(page, 'inbox-answered').waitFor();

    const { deliveries } = receivedSchema.parse(JSON.parse(await implementer('aeolus-fleet.sh', ['receive'])));
    expect(deliveries).toEqual([expect.objectContaining({ contentType: ANSWER_CONTENT_TYPE, inReplyTo: replacement.messageId })]);
    expect(JSON.parse(deliveries[0]?.payload ?? '')).toEqual({ questionId: replacement.questionId, option: 2 });
  });
});
