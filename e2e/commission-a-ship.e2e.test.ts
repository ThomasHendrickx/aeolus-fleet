import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sha256Hasher } from '../packages/server/src/adapters/crypto/secrets.js';
import { createPrismaClient, type PrismaClient } from '../packages/server/src/adapters/prisma/client.js';
import { createApp } from '../packages/server/src/app.js';
import type { AppRouter } from '../packages/server/src/index.js';
import { createUseCases, type UseCases } from '../packages/server/src/wiring.js';
import { FLEET_URL, OPERATOR, secretIn, shipIdIn } from '../packages/server/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../packages/server/test/support/database.js';
import { createTestClock } from '../packages/server/test/support/postgres-core.js';
import { unwrap } from '../packages/server/test/support/result.js';
import { signIn } from './support/console.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';

// Commissioning a ship, handing out its starting prompt, claiming it and
// releasing it, end to end: a browser signed in as argo, the web app, the
// server and Postgres.

const clock = createTestClock('2026-09-29T12:00:00.000Z');

let database: PrismaClient;
let useCases: UseCases;
let server: FastifyInstance;
let serverUrl: string;
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

/** A page signed in as argo, allowed to use the clipboard. */
async function signedInPage(): Promise<Page> {
  const context = await browser.newContext({ baseURL: web.url, permissions: ['clipboard-read', 'clipboard-write'] });
  contexts.push(context);
  const page = await context.newPage();
  await signIn(page, OPERATOR);
  await page.waitForURL(`${web.url}/`);
  await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
  return page;
}

async function commission(page: Page, ship: { name: string; type: string; note?: string }): Promise<void> {
  const form = page.getByTestId('commission-form');
  await form.getByLabel('Name').fill(ship.name);
  await form.getByLabel('Type').fill(ship.type);
  await form.getByLabel('Note (optional)').fill(ship.note ?? '');
  await form.getByRole('button', { name: 'Commission' }).click();
}

/** A ship's row in the overview's table: the phone list holds the same ships, hidden at this width. */
function shipRow(page: Page, name: string) {
  return page.getByTestId(`fleet-row-${name}`);
}

function promptBlock(page: Page, shipName: string) {
  return page.getByRole('region', { name: `Starting prompt for ${shipName}` });
}

async function promptTextIn(page: Page, shipName: string): Promise<string> {
  return (await promptBlock(page, shipName).getByTestId('starting-prompt-text').textContent()) ?? '';
}

async function promptSecretIn(page: Page, shipName: string): Promise<string> {
  return secretIn(await promptTextIn(page, shipName));
}

/** A tRPC client of the server, as a session crewing a ship calls it: with its crew token, if it has one. */
function sessionClient(crewToken?: string) {
  const headers: Record<string, string> = crewToken === undefined ? {} : { authorization: `Bearer ${crewToken}` };
  return createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${serverUrl}/trpc`, headers })] });
}

/** Commissions a ship in the console and claims it through the API, as a session would; returns its crew token. */
async function crewedShip(page: Page, ship: { name: string; type: string }): Promise<string> {
  await commission(page, ship);
  const prompt = await promptTextIn(page, ship.name);
  await promptBlock(page, ship.name).getByRole('button', { name: 'Done' }).click();
  const { crewToken } = await sessionClient().ship.register.mutate({
    shipId: shipIdIn(prompt),
    secret: secretIn(prompt),
    location: { kind: 'CLOUD' },
  });
  await shipRow(page, ship.name).getByText('Crewed').waitFor();
  return crewToken;
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
    await row.getByText(/^Prompt issued .*, not claimed yet$/).waitFor();
    await expect(row.getByRole('cell').nth(1).textContent()).resolves.toBe('reviewer');

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

  it('shows the crew line for the aeolus plugin beside the prompt, with the same ship and secret', async () => {
    const page = await signedInPage();
    await commission(page, { name: 'bosun', type: 'reviewer' });
    const block = promptBlock(page, 'bosun');
    const prompt = await promptTextIn(page, 'bosun');

    const crewLine = await block.getByTestId('starting-prompt-crew-line').textContent();

    expect(crewLine).toBe(`/aeolus:crew ${FLEET_URL} ${shipIdIn(prompt)} ${secretIn(prompt)}`);
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

describe('claiming a commissioned ship', () => {
  it('lists the ship as crewed where its session runs, without a reload, once a session claims it through the API', async () => {
    const page = await signedInPage();
    await commission(page, { name: 'navigator', type: 'reviewer' });
    const prompt = await promptTextIn(page, 'navigator');
    await promptBlock(page, 'navigator').getByRole('button', { name: 'Done' }).click();
    const row = shipRow(page, 'navigator');
    await row.getByText('Awaiting crew').waitFor();

    // A session claims the ship as the prompt tells it: register on the server, not through the console.
    const session = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${serverUrl}/trpc` })] });
    await session.ship.register.mutate({
      shipId: shipIdIn(prompt),
      secret: secretIn(prompt),
      location: { kind: 'OTHER', description: 'a ci runner' },
    });

    await row.getByText('Crewed').waitFor();
    await row.getByText('a ci runner', { exact: true }).waitFor();
    await expect(row.getByRole('button', { name: 'Get starting prompt' }).count()).resolves.toBe(0);
    await shipRow(page, 'argo').getByText('web console', { exact: true }).waitFor();
  });
});

describe('releasing a crewed ship', () => {
  it('releases it from the fleet list after a confirm: it shows Awaiting crew, and its session loses it', async () => {
    const page = await signedInPage();
    const crewToken = await crewedShip(page, { name: 'coxswain', type: 'reviewer' });
    const row = shipRow(page, 'coxswain');

    await row.getByTestId('fleet-ship-release').click();
    await row.getByRole('group', { name: 'Release coxswain?' }).getByRole('button', { name: 'Release ship' }).click();

    await row.getByText('Awaiting crew').waitFor();
    await row.getByText('No starting prompt issued').waitFor();
    await row.getByRole('button', { name: 'Get starting prompt' }).waitFor();
    await expect(sessionClient(crewToken).ship.whoami.query()).rejects.toThrow();
  });

  it('keeps the ship crewed when the confirm is cancelled', async () => {
    const page = await signedInPage();
    const crewToken = await crewedShip(page, { name: 'bowman', type: 'reviewer' });
    const row = shipRow(page, 'bowman');

    await row.getByTestId('fleet-ship-release').click();
    const confirmation = row.getByRole('group', { name: 'Release bowman?' });
    await confirmation.getByText(/Its secret stops working/).waitFor();
    await confirmation.getByRole('button', { name: 'Cancel' }).click();

    await confirmation.waitFor({ state: 'detached' });
    await row.getByText('Crewed').waitFor();
    await expect(sessionClient(crewToken).ship.whoami.query()).resolves.toMatchObject({ name: 'bowman' });
  });

  it('offers no Release for argo, and none for a ship awaiting crew', async () => {
    const page = await signedInPage();
    await commission(page, { name: 'oarsman', type: 'reviewer' });
    await promptBlock(page, 'oarsman').getByRole('button', { name: 'Done' }).click();
    await shipRow(page, 'oarsman').getByText('Awaiting crew').waitFor();

    await expect(shipRow(page, 'argo').getByTestId('fleet-ship-release').count()).resolves.toBe(0);
    await expect(shipRow(page, 'oarsman').getByTestId('fleet-ship-release').count()).resolves.toBe(0);
  });
});
