import type { FleetId } from '@aeolus-fleet/common';
import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../packages/core/src/adapters/prisma/client.js';
import { createApp } from '../packages/core/src/app.js';
import { createMigratedDatabase } from '../packages/core/src/testing/database.js';
import { unwrap } from '../packages/core/src/testing/result.js';
import { createUseCases } from '../packages/core/src/wiring.js';
import { FLEET_URL, OPERATOR } from '../packages/core/test/support/core-fixtures.js';
import { openRowMenu } from './support/console.js';
import { startFakePagasae, type FakePagasae } from './support/fake-pagasae.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';

// A person signed in as their own account gets a new starting prompt for the
// agent ship they commissioned, as any manage call (issue 1608).

let database: PrismaClient;
let pagasae: FakePagasae;
let server: FastifyInstance;
let web: RunningWeb;
let browser: Browser;
let fleetId: FleetId;
const contexts: BrowserContext[] = [];

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  ({ fleetId } = unwrap(await createUseCases({ prisma: database }).initialiseFleet({ name: 'home fleet', ...OPERATOR })));

  pagasae = await startFakePagasae();
  const webUrl = await reserveWebUrl();
  server = createApp({ databaseUrl, publicUrl: FLEET_URL, consoleOrigin: webUrl, logger: false, accountTokenIssuer: pagasae.url });
  const serverUrl = await server.listen({ host: '127.0.0.1', port: 0 });
  web = await startWeb({ url: webUrl, serverUrl, pagasae });
  browser = await launchChromium();
});

afterAll(async () => {
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
  await web.stop();
  await server.close();
  await pagasae.close();
  await database.$disconnect();
});

/** A page signed in as Mathilde's account, which may commission and manage, on the overview's list. */
async function mathildesPage(): Promise<Page> {
  pagasae.signInAs({
    id: 'acc-mathilde',
    email: 'mathilde@acme.example',
    fleets: [{ id: fleetId, name: 'home fleet', scopes: ['fleet:read', 'fleet:manage', 'fleet:commission'] }],
  });
  const context = await browser.newContext({ baseURL: web.url });
  contexts.push(context);
  const page = await context.newPage();
  await page.goto('/?view=list');
  await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
  // Live shows once the page is hydrated: a click before that does nothing.
  await page.getByRole('banner').getByText('Live', { exact: true }).waitFor({ timeout: 20_000 });
  return page;
}

describe('a person and the agent ship they commissioned', () => {
  it('gets a new starting prompt for it from its row, which stops the one shown at commission', async () => {
    const page = await mathildesPage();
    await page.getByTestId('fleet-commission').click();
    const commission = page.getByTestId('commission-dialog');
    await commission.getByTestId('commission-name').fill('writer');
    await commission.getByTestId('commission-type').fill('writer');
    await commission.getByTestId('commission-submit').click();
    const first = page.getByTestId('starting-prompt-dialog');
    const firstPrompt = (await first.getByTestId('starting-prompt-text').textContent()) ?? '';
    await first.getByRole('button', { name: 'Done' }).click();

    await openRowMenu(page, 'writer');
    await page.getByRole('menuitem', { name: 'Get starting prompt…' }).click();

    const dialog = page.getByTestId('starting-prompt-dialog');
    await dialog.getByText(/This prompt stops the one issued/).waitFor();
    await expect(dialog.getByTestId('starting-prompt-text').textContent()).resolves.not.toBe(firstPrompt);
    await expect(dialog.getByText('Couldn’t issue a starting prompt').count()).resolves.toBe(0);
  });
});
