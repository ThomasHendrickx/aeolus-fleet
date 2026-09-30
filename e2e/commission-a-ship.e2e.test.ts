import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sha256Hasher } from '../packages/server/src/adapters/crypto/secrets.js';
import { createPrismaClient, type PrismaClient } from '../packages/server/src/adapters/prisma/client.js';
import { createApp } from '../packages/server/src/app.js';
import { createUseCases, type UseCases } from '../packages/server/src/wiring.js';
import { FLEET_URL, OPERATOR, secretIn } from '../packages/server/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../packages/server/test/support/database.js';
import { createTestClock } from '../packages/server/test/support/postgres-core.js';
import { unwrap } from '../packages/server/test/support/result.js';
import { signIn } from './support/console.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';

// Commissioning a ship and handing out its starting prompt, end to end: a
// browser signed in as argo, the web app, the server and Postgres.

const clock = createTestClock('2026-09-29T12:00:00.000Z');

let database: PrismaClient;
let useCases: UseCases;
let server: FastifyInstance;
let web: RunningWeb;
let browser: Browser;
const contexts: BrowserContext[] = [];

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  useCases = createUseCases({ prisma: database, clock, fleetUrl: FLEET_URL });
  unwrap(await useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR }));

  const webUrl = await reserveWebUrl();
  server = createApp({ databaseUrl, publicUrl: FLEET_URL, consoleOrigin: webUrl, clock, logger: false });
  const serverUrl = await server.listen({ host: '127.0.0.1', port: 0 });
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

/** A page signed in as argo, allowed to use the clipboard. */
async function signedInPage(): Promise<Page> {
  const context = await browser.newContext({ baseURL: web.url, permissions: ['clipboard-read', 'clipboard-write'] });
  contexts.push(context);
  const page = await context.newPage();
  await signIn(page, OPERATOR);
  await page.waitForURL(`${web.url}/`);
  await page.getByText('Signed in as argo.').waitFor();
  return page;
}

async function commission(page: Page, ship: { name: string; type: string; note?: string }): Promise<void> {
  const form = page.getByTestId('commission-form');
  await form.getByLabel('Name').fill(ship.name);
  await form.getByLabel('Type').fill(ship.type);
  await form.getByLabel('Note (optional)').fill(ship.note ?? '');
  await form.getByRole('button', { name: 'Commission' }).click();
}

function shipRow(page: Page, name: string) {
  return page.getByTestId('fleet-ship').filter({ has: page.getByRole('rowheader', { name, exact: true }) });
}

function promptBlock(page: Page, shipName: string) {
  return page.getByRole('region', { name: `Starting prompt for ${shipName}` });
}

async function promptSecretIn(page: Page, shipName: string): Promise<string> {
  return secretIn((await promptBlock(page, shipName).getByTestId('starting-prompt-text').textContent()) ?? '');
}

/** Whether the secret is still valid: the one a session can claim its ship with. */
async function isValid(shipSecret: string): Promise<boolean> {
  const valid = await database.credential.count({
    where: { secretHash: sha256Hasher.hash(shipSecret), invalidatedAt: null },
  });
  return valid === 1;
}

describe('commissioning a ship in the console', () => {
  it('lists the new ship as awaiting crew and shows its first starting prompt once', async () => {
    const page = await signedInPage();

    await commission(page, { name: 'scout', type: 'reviewer', note: 'reviews pull requests' });

    const first = await promptSecretIn(page, 'scout');
    await expect(isValid(first)).resolves.toBe(true);
    const row = shipRow(page, 'scout');
    await row.getByText('Awaiting crew').waitFor();
    await row.getByText(/^Unclaimed, issued/).waitFor();
    await expect(row.getByRole('cell').nth(0).textContent()).resolves.toBe('reviewer');

    await promptBlock(page, 'scout').getByRole('button', { name: 'Done' }).click();
    await promptBlock(page, 'scout').waitFor({ state: 'detached' });
    await page.reload();
    await shipRow(page, 'scout').waitFor();
    await expect(page.getByTestId('starting-prompt-text').count()).resolves.toBe(0);
  });

  it('asks before replacing an unclaimed prompt, and replaces it only once confirmed', async () => {
    const page = await signedInPage();
    await commission(page, { name: 'lookout', type: 'reviewer' });
    const first = await promptSecretIn(page, 'lookout');
    await promptBlock(page, 'lookout').getByRole('button', { name: 'Done' }).click();
    const row = shipRow(page, 'lookout');

    await row.getByRole('button', { name: 'Get starting prompt' }).click();
    const confirmation = row.getByRole('group', { name: 'Replace the starting prompt for lookout' });
    await confirmation.getByText(/is still out\. A new one stops it working\./).waitFor();
    await confirmation.getByRole('button', { name: 'Cancel' }).click();

    await confirmation.waitFor({ state: 'detached' });
    await expect(isValid(first)).resolves.toBe(true);

    await row.getByRole('button', { name: 'Get starting prompt' }).click();
    await confirmation.getByRole('button', { name: 'Replace prompt' }).click();

    const second = await promptSecretIn(page, 'lookout');
    expect(second).not.toBe(first);
    await expect(isValid(first)).resolves.toBe(false);
    await expect(isValid(second)).resolves.toBe(true);
  });

  it('copies the starting prompt', async () => {
    const page = await signedInPage();
    await commission(page, { name: 'pilot', type: 'navigator' });
    const block = promptBlock(page, 'pilot');
    const shown = await block.getByTestId('starting-prompt-text').textContent();

    await block.getByTestId('starting-prompt-copy').click();

    await block.getByRole('status').getByText('Copied.').waitFor();
    await expect(page.evaluate('navigator.clipboard.readText()')).resolves.toBe(shown);
  });

  it('keeps the input and says why when a name is not a handle or already taken', async () => {
    const page = await signedInPage();
    const form = page.getByTestId('commission-form');

    await commission(page, { name: 'Harbour Master', type: 'reviewer' });
    await form.getByText('Use 1 to 48 lowercase letters, digits or hyphens').waitFor();
    await expect(form.getByLabel('Name').inputValue()).resolves.toBe('Harbour Master');

    await commission(page, { name: 'dock', type: 'reviewer' });
    await promptBlock(page, 'dock').getByRole('button', { name: 'Done' }).click();
    await commission(page, { name: 'dock', type: 'lookout' });
    await page.getByRole('alert').filter({ hasText: 'An active ship is already named dock' }).waitFor();
    await expect(form.getByLabel('Type').inputValue()).resolves.toBe('lookout');
  });
});
