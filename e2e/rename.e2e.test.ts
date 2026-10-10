import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createPrismaClient, type PrismaClient } from '../packages/core/src/adapters/prisma/client.js';
import { createApp } from '../packages/core/src/app.js';
import type { Caller } from '../packages/core/src/domain/shared/caller.js';
import { createUseCases, type UseCases } from '../packages/core/src/wiring.js';
import { FLEET_URL, OPERATOR, operatorCaller } from '../packages/core/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../packages/core/test/support/database.js';
import { createTestClock } from '../packages/core/test/support/postgres-core.js';
import { unwrap } from '../packages/core/test/support/result.js';
import { signIn } from './support/console.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';
import { newKey } from '../packages/core/test/support/keys.js';

// Rename, end to end: the operator renames a ship from its page with the
// live name check and the typed confirm; the page and its timeline show the
// new name.

const clock = createTestClock('2026-10-01T09:00:00.000Z');
/** Sign-ins are rate limited per window; each test signs in after the window of the one before. */
const SIGN_IN_WINDOW_MS = 60_000;

let database: PrismaClient;
let useCases: UseCases;
let argo: Caller;
let server: FastifyInstance;
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
  });
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

async function signedInPage(): Promise<Page> {
  clock.advance(SIGN_IN_WINDOW_MS);
  const context = await browser.newContext({ baseURL: web.url });
  contexts.push(context);
  const page = await context.newPage();
  await signIn(page, OPERATOR);
  await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
  return page;
}

describe('renaming a ship', () => {
  it('renames a ship from its page after the name check, the dialog being the confirm; the page shows the new name', async () => {
    const { shipId } = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'reviewer-01', type: 'reviewer' }));
    unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'planner', type: 'planner' }));
    const page = await signedInPage();
    await page.goto(`/ships/${shipId}`);

    await page.getByTestId('fleet-ship-rename').click();
    const dialog = page.getByTestId('rename-dialog');
    await dialog.getByTestId('rename-name').fill('planner');
    await dialog.getByText('planner is already used by an active ship.').waitFor();
    await dialog.getByTestId('rename-name').fill('reviewer-web');
    await dialog.getByText('reviewer-web is available.').waitFor();
    // The dialog is the confirm: no typed name.
    await dialog.getByTestId('rename-submit').click();

    await dialog.waitFor({ state: 'hidden' });
    await page.getByRole('heading', { name: 'reviewer-web' }).first().waitFor();
    await page.getByText('Renamed from reviewer-01 to reviewer-web by argo').waitFor();
    await expect(database.ship.findUniqueOrThrow({ where: { id: shipId } })).resolves.toMatchObject({ name: 'reviewer-web' });
  });

  it('turns uppercase typed into the new name into lowercase', async () => {
    const { shipId } = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'deckhand', type: 'crew' }));
    const page = await signedInPage();
    await page.goto(`/ships/${shipId}`);
    await page.getByTestId('fleet-ship-rename').click();
    const dialog = page.getByTestId('rename-dialog');

    await dialog.getByTestId('rename-name').fill('Hemma:Deckhand');

    await expect(dialog.getByTestId('rename-name').inputValue()).resolves.toBe('hemma:deckhand');
    await dialog.getByText('hemma:deckhand is available.').waitFor();
  });
});

describe('/version', () => {
  it("answers only the versions of the web app and the server, without a session", async () => {
    const response = await fetch(`${web.url}/version`);

    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    // The schema drops what it does not name, so an answer saying more than these versions differs from it.
    expect(z.object({ web: z.string(), server: z.object({ server: z.string(), common: z.string() }) }).parse(body)).toEqual(body);
  });
});
