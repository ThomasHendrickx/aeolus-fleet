import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sha256Hasher } from '../packages/core/src/adapters/crypto/secrets.js';
import { createPrismaClient, type PrismaClient } from '../packages/core/src/adapters/prisma/client.js';
import { createApp } from '../packages/core/src/app.js';
import type { AppRouter } from '../packages/core/src/index.js';
import { createUseCases, type UseCases } from '../packages/core/src/wiring.js';
import type { Caller } from '../packages/core/src/domain/shared/caller.js';
import { FLEET_URL, OPERATOR, operatorCaller, secretIn, shipIdIn } from '../packages/core/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../packages/core/test/support/database.js';
import { createTestClock } from '../packages/core/test/support/postgres-core.js';
import { unwrap } from '../packages/core/test/support/result.js';
import { signIn, openRowMenu } from './support/console.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';

// Commissioning a ship, handing out its starting prompt, claiming it and
// releasing it, end to end: a browser signed in as argo, the web app, the
// server and Postgres.

const clock = createTestClock('2026-09-29T12:00:00.000Z');

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
  // A new rate-limit window first, so the sign-ins of many tests never hit the limit.
  clock.advance(60_000);
  await signIn(page, OPERATOR);
  await page.waitForURL(`${web.url}/`);
  await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
  return page;
}

/** Fills the CommissionDialog, opened from the overview's primary action. */
async function fillCommission(page: Page, ship: { name: string; type: string; note?: string }): Promise<void> {
  await page.getByTestId('fleet-commission').click();
  const dialog = page.getByTestId('commission-dialog');
  await dialog.getByTestId('commission-name').fill(ship.name);
  await dialog.getByTestId('commission-type').fill(ship.type);
  await dialog.getByTestId('commission-note').fill(ship.note ?? '');
}

async function commission(page: Page, ship: { name: string; type: string; note?: string }): Promise<void> {
  await fillCommission(page, ship);
  await page.getByTestId('commission-dialog').getByTestId('commission-submit').click();
}

/** A ship's row in the overview's table: the phone list holds the same ships, hidden at this width. */
function shipRow(page: Page, name: string) {
  return page.getByTestId(`fleet-row-${name}`);
}

/** The StartingPromptDialog showing the ship's prompt, once. */
function promptBlock(page: Page, shipName: string) {
  return page.getByTestId('starting-prompt-dialog').filter({ hasText: shipName });
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
    location: { kind: 'CLOUD' }, harness: 'claude-code',
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
    await promptBlock(page, 'scout').getByRole('button', { name: 'Done' }).click();
    await promptBlock(page, 'scout').waitFor({ state: 'detached' });
    const row = shipRow(page, 'scout');
    await row.getByText('Awaiting crew').waitFor();
    await row.getByText(/^Prompt issued .*, not claimed yet$/).waitFor();
    await page.reload();
    await shipRow(page, 'scout').waitFor();
    await expect(page.getByTestId('starting-prompt-text').count()).resolves.toBe(0);
  });

  it('commissions a ship whose name and type hold a colon, and lists them as typed', async () => {
    const page = await signedInPage();

    await commission(page, { name: 'hemma-a1b2:planner', type: 'hemma:planner' });

    await promptBlock(page, 'hemma-a1b2:planner').getByRole('button', { name: 'Done' }).click();
    const row = shipRow(page, 'hemma-a1b2:planner');
    await row.getByText('Awaiting crew').waitFor();
    // The type is no longer a column: the ship page shows it.
    await row.getByRole('link', { name: 'hemma-a1b2:planner' }).click();
    await page.getByTestId('ship-header').getByText('hemma:planner', { exact: true }).waitFor();
  });

  it('turns uppercase typed into the name and type into lowercase', async () => {
    const page = await signedInPage();
    const dialog = page.getByTestId('commission-dialog');

    await fillCommission(page, { name: 'HemmaFeature:Planner', type: 'Hemma:Planner' });

    await expect(dialog.getByTestId('commission-name').inputValue()).resolves.toBe('hemmafeature:planner');
    await expect(dialog.getByTestId('commission-type').inputValue()).resolves.toBe('hemma:planner');
    await dialog.getByText('hemmafeature:planner is available.').waitFor();
  });

  it('commissions a ship with fleet access, shown as its scopes on its page', async () => {
    const page = await signedInPage();
    await fillCommission(page, { name: 'squad-manager', type: 'squadron' });
    const dialog = page.getByTestId('commission-dialog');
    await dialog.getByTestId('commission-fleet-read').click();
    await dialog.getByTestId('commission-fleet-manage').click();

    await dialog.getByTestId('commission-submit').click();

    await promptBlock(page, 'squad-manager').getByRole('button', { name: 'Done' }).click();
    await shipRow(page, 'squad-manager').getByRole('link', { name: /squad-manager/ }).click();
    await page.getByTestId('ship-fleet-scope').getByText('fleet:manage').waitFor();
    await expect(page.getByTestId('ship-fleet-scope').allTextContents()).resolves.toEqual(['fleet:read', 'fleet:manage']);
  });

  it('commissions a trierarch with fleet:crew, shown on its page', async () => {
    const page = await signedInPage();
    await fillCommission(page, { name: 'mac-mini', type: 'trierarch' });
    const dialog = page.getByTestId('commission-dialog');
    await dialog.getByTestId('commission-fleet-crew').click();

    await dialog.getByTestId('commission-submit').click();

    await promptBlock(page, 'mac-mini').getByRole('button', { name: 'Done' }).click();
    await shipRow(page, 'mac-mini').getByRole('link', { name: /mac-mini/ }).click();
    await page.getByTestId('ship-fleet-scope').getByText('fleet:crew').waitFor();
    await expect(page.getByTestId('ship-fleet-scope').allTextContents()).resolves.toEqual(['fleet:crew']);
  });

  it('replaces an unclaimed prompt at once, saying the old one stops working', async () => {
    const page = await signedInPage();
    await commission(page, { name: 'lookout', type: 'reviewer' });
    const first = await promptSecretIn(page, 'lookout');
    await promptBlock(page, 'lookout').getByRole('button', { name: 'Done' }).click();
    const row = shipRow(page, 'lookout');

    await expect(isValid(first)).resolves.toBe(true);

    // No confirm: the new prompt is issued at once, and the dialog says the old one stops working.
    await row.getByRole('button', { name: 'Get starting prompt' }).click();
    const dialog = page.getByTestId('starting-prompt-dialog');
    await dialog.getByText(/This prompt stops the one issued/).waitFor();

    const second = secretIn((await dialog.getByTestId('starting-prompt-text').textContent()) ?? '');
    expect(second).not.toBe(first);
    await expect(isValid(first)).resolves.toBe(false);
    await expect(isValid(second)).resolves.toBe(true);
  });

  it('shows a crew line per harness with the aeolus plugin beside the prompt, Claude Code and Codex, with the same ship and secret', async () => {
    const page = await signedInPage();
    await commission(page, { name: 'bosun', type: 'reviewer' });
    const block = promptBlock(page, 'bosun');
    const prompt = await promptTextIn(page, 'bosun');
    const identity = `${FLEET_URL} ${shipIdIn(prompt)} ${secretIn(prompt)}`;

    await expect(block.getByTestId('starting-prompt-crew-line-claude-code').textContent()).resolves.toBe(`/aeolus:crew ${identity}`);
    await expect(block.getByTestId('starting-prompt-crew-line-codex').textContent()).resolves.toBe(`$aeolus-crew ${identity}`);
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

  it('says as the operator types whether a name is free, and why not, and keeps Commission disabled until it is', async () => {
    const page = await signedInPage();
    await commission(page, { name: 'dock', type: 'reviewer' });
    await promptBlock(page, 'dock').getByRole('button', { name: 'Done' }).click();
    const dialog = page.getByTestId('commission-dialog');

    await fillCommission(page, { name: 'Harbour Master', type: 'reviewer' });
    await dialog.getByText('Use 1 to 48 lowercase letters, digits, hyphens or colons.').waitFor();
    await expect(dialog.getByTestId('commission-submit').isDisabled()).resolves.toBe(true);

    await dialog.getByTestId('commission-name').fill('dock');
    await dialog.getByText('dock is already used by an active ship.').waitFor();
    await expect(dialog.getByTestId('commission-submit').isDisabled()).resolves.toBe(true);

    await dialog.getByTestId('commission-name').fill('harbour');
    await dialog.getByText('harbour is available.').waitFor();
    await dialog.getByText(/^\d+ ships? uses? this type\.$/).waitFor();
    await expect(dialog.getByTestId('commission-submit').isEnabled()).resolves.toBe(true);
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
      location: { kind: 'OTHER', description: 'a ci runner' }, harness: 'claude-code',
    });

    await row.getByText('Crewed').waitFor();
    await expect(row.locator('[data-slot="location-tag"]').getAttribute('title')).resolves.toBe('Claude Code · Other: a ci runner');
    await expect(row.getByRole('button', { name: 'Get starting prompt' }).count()).resolves.toBe(0);
    await shipRow(page, 'argo').getByText(/· Chrome/).waitFor();
  });
});

describe('releasing a crewed ship', () => {
  it('releases it from the fleet list after a confirm: it shows Awaiting crew, and its session loses it', async () => {
    const page = await signedInPage();
    const crewToken = await crewedShip(page, { name: 'coxswain', type: 'reviewer' });
    const row = shipRow(page, 'coxswain');

    await openRowMenu(page, 'coxswain');
    await page.getByTestId('fleet-ship-release').click();
    await page.getByTestId('release-dialog').getByRole('button', { name: 'Release ship' }).click();

    await row.getByText('Awaiting crew').waitFor();
    await row.getByText('No starting prompt issued').waitFor();
    await row.getByRole('button', { name: 'Get starting prompt' }).waitFor();
    await expect(sessionClient(crewToken).ship.whoami.query()).rejects.toThrow();
  });

  it('keeps the ship crewed when the confirm is cancelled', async () => {
    const page = await signedInPage();
    const crewToken = await crewedShip(page, { name: 'bowman', type: 'reviewer' });
    const row = shipRow(page, 'bowman');

    await openRowMenu(page, 'bowman');
    await page.getByTestId('fleet-ship-release').click();
    const confirmation = page.getByTestId('release-dialog');
    await confirmation.getByText(/Its secret and crew token stop working/).waitFor();
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

    await openRowMenu(page, 'argo');
    await page.getByTestId('fleet-ship-open-inbox').waitFor();
    await expect(page.getByTestId('fleet-ship-release').count()).resolves.toBe(0);
    await page.keyboard.press('Escape');
    await openRowMenu(page, 'oarsman');
    await page.getByTestId('fleet-ship-rename').waitFor();
    await expect(page.getByTestId('fleet-ship-release').count()).resolves.toBe(0);
  });
});

describe('re-crewing a crewed ship', () => {
  it('releases it and shows a fresh starting prompt and crew line once: the old session loses it, the new secret claims it', async () => {
    const page = await signedInPage();
    const crewToken = await crewedShip(page, { name: 'helmsman', type: 'reviewer' });
    const row = shipRow(page, 'helmsman');

    await openRowMenu(page, 'helmsman');
    await page.getByTestId('fleet-ship-recrew').click();
    const confirmation = page.getByTestId('recrew-dialog');
    await confirmation.getByText(/A new starting prompt and its crew lines are shown once/).waitFor();
    await confirmation.getByRole('button', { name: 'Re-crew ship' }).click();

    const dialog = page.getByTestId('starting-prompt-dialog');
    const prompt = (await dialog.getByTestId('starting-prompt-text').textContent()) ?? '';
    await expect(dialog.getByTestId('starting-prompt-crew-line-claude-code').textContent()).resolves.toBe(
      `/aeolus:crew ${FLEET_URL} ${shipIdIn(prompt)} ${secretIn(prompt)}`,
    );
    await expect(isValid(secretIn(prompt))).resolves.toBe(true);
    await expect(sessionClient(crewToken).ship.whoami.query()).rejects.toThrow();
    await dialog.getByRole('button', { name: 'Done' }).click();
    await row.getByText('Awaiting crew').waitFor();
  });
});

describe('re-crewing after a replaced prompt', () => {
  it('says nothing is replaced by the prompt after a re-crew, even after an earlier prompt replaced one', async () => {
    const page = await signedInPage();
    await commission(page, { name: 'quartermaster', type: 'reviewer' });
    await promptBlock(page, 'quartermaster').getByRole('button', { name: 'Done' }).click();
    // Both from the row menu: one ShipActions holds what the last prompt replaced.
    await openRowMenu(page, 'quartermaster');
    await page.getByRole('menuitem', { name: 'Get starting prompt…' }).click();
    const replaced = page.getByTestId('starting-prompt-dialog');
    await replaced.getByText(/This prompt stops the one issued/).waitFor();
    const prompt = (await replaced.getByTestId('starting-prompt-text').textContent()) ?? '';
    await replaced.getByRole('button', { name: 'Done' }).click();
    await sessionClient().ship.register.mutate({ shipId: shipIdIn(prompt), secret: secretIn(prompt), location: { kind: 'CLOUD' }, harness: 'claude-code' });
    await shipRow(page, 'quartermaster').getByText('Crewed').waitFor();

    await openRowMenu(page, 'quartermaster');
    await page.getByTestId('fleet-ship-recrew').click();
    await page.getByTestId('recrew-dialog').getByRole('button', { name: 'Re-crew ship' }).click();

    const dialog = page.getByTestId('starting-prompt-dialog');
    await dialog.getByTestId('starting-prompt-text').waitFor();
    await expect(dialog.getByText(/This prompt stops the one issued/).count()).resolves.toBe(0);
  });
});

describe('retiring a ship', () => {
  it('retires it after the typed confirm: gone from the default overview, shown under Show retired', async () => {
    const page = await signedInPage();
    await commission(page, { name: 'castaway', type: 'reviewer' });
    const prompt = await promptTextIn(page, 'castaway');
    await promptBlock(page, 'castaway').getByRole('button', { name: 'Done' }).click();
    await sessionClient().ship.register.mutate({ shipId: shipIdIn(prompt), secret: secretIn(prompt), location: { kind: 'CLOUD' }, harness: 'claude-code' });
    unwrap(
      await useCases.sendMessage(argo, {
        selector: { kind: 'ship', name: 'castaway' },
        payload: 'Last orders',
        idempotencyKey: 'castaway-1',
      }),
    );
    const row = shipRow(page, 'castaway');
    await row.getByText('Crewed').waitFor();

    await openRowMenu(page, 'castaway');
    await page.getByTestId('fleet-ship-retire').click();
    const dialog = page.getByTestId('retire-dialog');
    const retire = dialog.getByRole('button', { name: 'Retire and abandon 1 delivery' });
    await expect(retire.isDisabled()).resolves.toBe(true);
    await dialog.getByTestId('retire-typed-confirm').getByRole('textbox').fill('castaway');
    await retire.click();

    await row.waitFor({ state: 'detached' });
    await page.getByTestId('fleet-show-retired').click();
    await shipRow(page, 'castaway').getByText('Retired', { exact: true }).waitFor();
    await expect(
      database.delivery.count({ where: { recipientShip: { name: 'castaway' }, state: 'abandoned' } }),
    ).resolves.toBe(1);
  });
});
