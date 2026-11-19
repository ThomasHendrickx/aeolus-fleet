import type { FleetId } from '@aeolus-fleet/common';
import { paletteListSchema, PALETTE_LIST_PATH, type PaletteList } from '@aeolus-fleet/common';
import type { FastifyInstance } from 'fastify';
import { createServer, type Server } from 'node:http';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../packages/core/src/adapters/prisma/client.js';
import { createApp } from '../packages/core/src/app.js';
import { createMigratedDatabase } from '../packages/core/src/testing/database.js';
import { unwrap } from '../packages/core/src/testing/result.js';
import { createUseCases } from '../packages/core/src/wiring.js';
import { FLEET_URL, OPERATOR } from '../packages/core/test/support/core-fixtures.js';
import { startFakeAccountApp, type FakeAccountApp } from './support/fake-account-app.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';

// The palette across apps (docs/design/header-across-apps.md, A1 to A3, M2),
// end to end: the console serves its own list at the fixed path, and reads
// the lists of the other apps the account may open, here a fake gateway and
// a fake Account, each serving its list as those apps will.

const MCP_ADDRESS = 'https://gateway.acme.example/mcp';

const gatewayList: PaletteList = {
  app: 'gateway',
  entries: [
    { kind: 'page', key: 'fleet', label: 'Your fleet', path: '/fleet', keywords: [], rights: [], icon: 'lock' },
    { kind: 'copy', key: 'mcp-address', label: 'Copy MCP address', value: MCP_ADDRESS, keywords: ['mcp'], rights: [], icon: 'copy' },
  ],
};
const accountList: PaletteList = {
  app: 'account',
  entries: [{ kind: 'page', key: 'rights', label: 'Your rights', path: '/rights', keywords: [], rights: [], icon: 'shield' }],
};

let database: PrismaClient;
let accountApp: FakeAccountApp;
let server: FastifyInstance;
let web: RunningWeb;
let browser: Browser;
let fleetId: FleetId;
let gateway: Server;
let account: Server;
const contexts: BrowserContext[] = [];

/**
 * An app serving its palette list at the fixed path, and a page anywhere else,
 * on a host of its own under localhost: an apps list names apps by domain name.
 */
async function anApp(list: PaletteList): Promise<{ server: Server; url: string }> {
  const app = createServer((request, response) => {
    if (request.url === PALETTE_LIST_PATH) {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(list));
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' }).end(`<h1>${list.app} ${request.url ?? ''}</h1>`);
  });
  await new Promise<void>((resolve) => app.listen(0, resolve));
  const address = app.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the app listens on no port');
  }
  return { server: app, url: `http://${list.app}.localhost:${String(address.port)}/` };
}

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  const useCases = createUseCases({ prisma: database });
  ({ fleetId } = unwrap(await useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR })));
  const gatewayApp = await anApp(gatewayList);
  const accountPaletteApp = await anApp(accountList);
  gateway = gatewayApp.server;
  account = accountPaletteApp.server;
  accountApp = await startFakeAccountApp({ accountUrl: accountPaletteApp.url, gatewayUrl: gatewayApp.url });
  const webUrl = await reserveWebUrl();
  server = createApp({ databaseUrl, publicUrl: FLEET_URL, consoleOrigin: webUrl, logger: false, accountTokenIssuer: accountApp.url });
  const serverUrl = await server.listen({ host: '127.0.0.1', port: 0 });
  web = await startWeb({ url: webUrl, serverUrl, accountApp });
  browser = await launchChromium();
  accountApp.signInAs({ id: 'acc-sam', email: 'sam@acme.example', fleets: [{ id: fleetId, name: 'home fleet', scopes: ['fleet:read'] }] });
});

afterAll(async () => {
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
  await web.stop();
  await server.close();
  await accountApp.close();
  gateway.close();
  account.close();
  await database.$disconnect();
});

/** The account signed in to the console, its palette open on what is typed. */
async function paletteFor(query: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: web.url, permissions: ['clipboard-read', 'clipboard-write'] });
  contexts.push(context);
  const page = await context.newPage();
  await page.goto('/');
  await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
  await page.getByTestId('header-search').click();
  await page.getByTestId('command-palette-input').fill(query);
  return page;
}

describe('the palette across apps', () => {
  it('serves the console list without a sign-in: every page of its navigation and the actions of its palette, with the rights each needs (A1)', async () => {
    // Given the console runs, without squadrons or the trierarch plugin
    // When another app's server asks for its list, with no sign-in
    const response = await fetch(`${web.url}${PALETTE_LIST_PATH}`);
    // Then it answers the console's pages and actions, every one, and no data
    const list = paletteListSchema.parse(await response.json());
    expect(list.app).toBe('console');
    expect(list.entries.map((entry) => ({ key: entry.key, kind: entry.kind, path: entry.kind === 'copy' ? undefined : entry.path, rights: entry.rights }))).toEqual([
      { key: 'commission', kind: 'action', path: '/?commission=new', rights: ['fleet:manage'] },
      { key: 'compose', kind: 'action', path: '/?compose=new', rights: ['messages:send'] },
      { key: 'overview', kind: 'page', path: '/', rights: ['fleet:read'] },
      { key: 'health', kind: 'page', path: '/fleet-health', rights: ['fleet:read'] },
      { key: 'needs-crew', kind: 'page', path: '/needs-crew', rights: ['fleet:read'] },
      { key: 'inbox', kind: 'page', path: '/inbox', rights: ['fleet:read'] },
      { key: 'network', kind: 'page', path: '/network', rights: ['fleet:network'] },
      { key: 'settings', kind: 'page', path: '/settings', rights: ['fleet:manage'] },
    ]);
  });

  it("offers the gateway's Copy MCP address in the console; Enter copies it and says Copied, opening no app (A3)", async () => {
    // Given the account may open the gateway, its palette open on "mcp"
    const page = await paletteFor('mcp');
    const copy = page.locator('[data-testid="command-palette-item"][data-item-key="gateway:mcp-address"]');
    await copy.waitFor();

    // When it presses Enter on Copy MCP address
    await copy.locator('xpath=self::*[@aria-selected="true"]').waitFor();
    await page.keyboard.press('Enter');

    // Then the address is copied, the row says Copied, and the console stays
    await copy.getByText('Copied').waitFor();
    await expect(page.evaluate('navigator.clipboard.readText()')).resolves.toBe(MCP_ADDRESS);
    expect(new URL(page.url()).origin).toBe(web.url);
  });

  it("finds Account's Your rights from the console, under Account, and opens it there (A2, M2)", async () => {
    // Given the account's palette open on "rights"
    const page = await paletteFor('rights');
    const rights = page.locator('[data-testid="command-palette-item"][data-item-key="account:rights"]');

    // Then Your rights shows, naming the app it opens
    await expect(rights.getByTestId('command-palette-item-app').textContent()).resolves.toBe('Account');

    // When the account chooses it
    await rights.click();

    // Then Account opens on Your rights
    await page.waitForURL((url) => url.pathname === '/rights' && url.origin !== web.url);
    await page.getByText('account /rights').waitFor();
  });
});
