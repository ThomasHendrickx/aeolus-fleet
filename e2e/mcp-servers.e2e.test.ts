import type { FleetId } from '@aeolus-fleet/common';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, type PrismaClient } from '../packages/core/src/adapters/prisma/client.js';
import { createApp } from '../packages/core/src/app.js';
import type { AppRouter } from '../packages/core/src/index.js';
import { createMigratedDatabase } from '../packages/core/src/testing/database.js';
import { newKey } from '../packages/core/src/testing/keys.js';
import { FLEET_URL } from '../packages/core/test/support/core-fixtures.js';
import { startFakeTrierarchPlugin, type FakeTrierarchPlugin } from './support/fake-trierarch-plugin.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';

/** Approved MCP page journeys: manager saves write-only values, viewer makes no MCP read. */
const INSTALLATION_TOKEN = 'aeolus_installation_test_mcp_1735';
let database: PrismaClient;
let server: FastifyInstance;
let serverUrl: string;
let web: RunningWeb;
let browser: Browser;
let plugin: FakeTrierarchPlugin;
let context: BrowserContext | undefined;
let fleetId: FleetId;
function installation() {
  return createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${serverUrl}/trpc`, headers: { 'x-aeolus-installation-token': INSTALLATION_TOKEN } })] })
    .installation;
}
beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  const webUrl = await reserveWebUrl();
  server = createApp({ databaseUrl, publicUrl: FLEET_URL, consoleOrigin: webUrl, logger: false, installationToken: INSTALLATION_TOKEN });
  serverUrl = await server.listen({ host: '127.0.0.1', port: 0 });
  plugin = await startFakeTrierarchPlugin();
  web = await startWeb({ url: webUrl, serverUrl, trierarchPluginUrl: plugin.url });
  browser = await launchChromium();
  ({ fleetId } = await installation().fleets.create.mutate({ requestId: newKey(), name: 'MCP fleet', operatorEmail: 'mcp@example.com', viewer: true }));
});
afterAll(async () => {
  await context?.close();
  await browser.close();
  await web.stop();
  await plugin.stop();
  await server.close();
  await database.$disconnect();
});

describe('Fleet crew MCP console page', () => {
  it('a viewer opening the MCP URL sees the machines with no tabs and makes no mcp.get call', async () => {
    // Given a signed-in viewer and the connected trierarch plugin.
    context = await browser.newContext({ baseURL: web.url });
    const page = await context.newPage();
    const { ticket } = await installation().operators.issueSignInTicket.mutate({ fleetId, as: 'viewer' });
    await page.goto(`/sign-in/ticket?ticket=${encodeURIComponent(ticket)}`);
    await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
    const readsBefore = plugin.mcpReads();
    const calls: string[] = [];
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (path.endsWith('/mcp.get')) calls.push(path);
    });
    // When the viewer opens the direct MCP page URL.
    await page.goto('/trierarchs/mcp-servers');
    await page.getByTestId('machine-list').waitFor();
    // Then the existing machines screen stays, with neither tabs nor metadata calls.
    expect(await page.getByRole('tab', { name: 'MCP servers' }).count()).toBe(0);
    expect(await page.getByRole('heading', { name: 'Servers', exact: true }).count()).toBe(0);
    expect(calls).toEqual([]);
    expect(plugin.mcpReads()).toBe(readsBefore);
    await context.close();
    context = undefined;
  });
  it('a manager adds a server and new write-only credential through the console route', async () => {
    // Given a manager at the machines page.
    context = await browser.newContext({ baseURL: web.url });
    const page = await context.newPage();
    const { ticket } = await installation().operators.issueSignInTicket.mutate({ fleetId });
    await page.goto(`/sign-in/ticket?ticket=${encodeURIComponent(ticket)}`);
    await page.getByTestId('fleet-commission').waitFor();
    await page.goto('/trierarchs');
    await page.getByTestId('trierarchs-mcp-tab').click();
    await page.getByText('No MCP servers yet').waitFor();
    // When a server with a new credential is saved.
    await page.getByTestId('mcp-add-server').click();
    const form = page.getByTestId('mcp-form');
    await form.getByTestId('mcp-name').fill('docs');
    await form.getByTestId('mcp-url').fill('https://docs.example.com/mcp');
    await form.getByTestId('mcp-tool').fill('search,read');
    await form.getByTestId('mcp-add-tool').click();
    await form.getByTestId('mcp-credential').click();
    await form.getByTestId('mcp-secret-name').fill('docs-key');
    await form.getByTestId('mcp-value').fill('write-only-test-example');
    expect(await form.getByTestId('mcp-value').getAttribute('type')).toBe('password');
    await form.getByTestId('mcp-submit').click();
    // Then one replacement saves version 8 and the closed form retains no value in the page.
    await page.getByText('Saved as version 8').waitFor();
    expect(await form.count()).toBe(0);
    expect(await page.getByText('Version 8', { exact: true }).count()).toBe(1);
    expect(await page.getByText('write-only-test-example', { exact: true }).count()).toBe(0);
    expect(plugin.mcpSaves()).toBe(1);
  });
});
