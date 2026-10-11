import { createServer, type Server } from 'node:http';

import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../packages/core/src/adapters/prisma/client.js';
import { createApp } from '../packages/core/src/app.js';
import type { AppRouter } from '../packages/core/src/index.js';
import { FLEET_URL } from '../packages/core/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../packages/core/test/support/database.js';
import { newKey } from '../packages/core/test/support/keys.js';
import { createTestClock } from '../packages/core/test/support/postgres-core.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';

// A hosted console, end to end: the hosting service's sign-in page stands in
// as a stub, the installation issues sign-in tickets, and the console never
// serves a password form.

const INSTALLATION_TOKEN = 'aeolus_installation_test_0123456789abcdef';
const clock = createTestClock('2026-10-04T12:00:00.000Z');

let database: PrismaClient;
let server: FastifyInstance;
let serverUrl: string;
let hostedSignIn: Server;
let hostedSignInUrl: string;
let web: RunningWeb;
let browser: Browser;
const contexts: BrowserContext[] = [];
let fleetId: string;

function installation() {
  return createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${serverUrl}/trpc`, headers: { 'x-aeolus-installation-token': INSTALLATION_TOKEN } })] }).installation;
}

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  hostedSignIn = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>pagasae</title><h1>Sign in or sign up</h1>');
  });
  await new Promise<void>((resolve) => hostedSignIn.listen(0, '127.0.0.1', resolve));
  const address = hostedSignIn.address();
  hostedSignInUrl = `http://127.0.0.1:${String(typeof address === 'object' && address !== null ? address.port : 0)}/sign-in`;
  const webUrl = await reserveWebUrl();
  server = createApp({ databaseUrl, publicUrl: FLEET_URL, consoleOrigin: webUrl, clock, logger: false, installationToken: INSTALLATION_TOKEN });
  serverUrl = await server.listen({ host: '127.0.0.1', port: 0 });
  web = await startWeb({ url: webUrl, serverUrl, hostedSignInUrl });
  browser = await launchChromium();
  ({ fleetId } = await installation().fleets.create.mutate({ requestId: newKey(), name: 'mira-lab', operatorEmail: 'mira@example.com' }));
});

afterAll(async () => {
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
  await web.stop();
  await server.close();
  await new Promise((resolve) => hostedSignIn.close(resolve));
  await database.$disconnect();
});

async function newPage() {
  const context = await browser.newContext({ baseURL: web.url });
  contexts.push(context);
  return context.newPage();
}

describe('a hosted console', () => {
  it('answers its sign-in route with a redirect to the hosting service, and serves no password form', async () => {
    const response = await fetch(`${web.url}/sign-in`, { redirect: 'manual' });

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(response.headers.get('location')).toBe(hostedSignInUrl);
    expect(await response.text()).not.toMatch(/type="password"/);
  });

  it("redirects a console page asked for without a session straight to the hosting service's sign-in, on the server", async () => {
    const response = await fetch(`${web.url}/`, { redirect: 'manual' });

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(response.headers.get('location')).toBe(hostedSignInUrl);
  });

  it('signs the operator in with a ticket, into the console, without the ticket in the address', async () => {
    const { ticket } = await installation().operators.issueSignInTicket.mutate({ fleetId });
    const page = await newPage();

    await page.goto(`/sign-in/ticket?ticket=${encodeURIComponent(ticket)}`);

    await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
    expect(new URL(page.url()).pathname).toBe('/');
    expect(page.url()).not.toContain(ticket);
  });

  it('takes a ticket once: a second use says the sign-in did not go through and points back to the hosting service', async () => {
    const { ticket } = await installation().operators.issueSignInTicket.mutate({ fleetId });
    const page = await newPage();
    await page.goto(`/sign-in/ticket?ticket=${encodeURIComponent(ticket)}`);
    await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();

    const again = await newPage();
    await again.goto(`/sign-in/ticket?ticket=${encodeURIComponent(ticket)}`);

    await again.getByRole('heading', { name: 'We couldn’t sign you in' }).waitFor();
    await expect(again.getByTestId('sign-in-failed-again').getAttribute('href')).resolves.toBe(hostedSignInUrl);
    await expect(again.locator('input[type="password"]').count()).resolves.toBe(0);
  });

  it("says the operator signed in somewhere else before the hosting service's sign-in, and serves no password form", async () => {
    const page = await newPage();

    await page.goto('/sign-in?notice=signed-in-elsewhere');

    await page.getByTestId('sign-in-signed-in-elsewhere').getByText('You signed in somewhere else').waitFor();
    await expect(page.getByTestId('sign-in-elsewhere-again').getAttribute('href')).resolves.toBe(hostedSignInUrl);
    await expect(page.locator('input[type="password"]').count()).resolves.toBe(0);
  });

  it('shows a page left open the notice once the operator signs in somewhere else and it goes on', async () => {
    const left = await newPage();
    await left.goto(`/sign-in/ticket?ticket=${encodeURIComponent((await installation().operators.issueSignInTicket.mutate({ fleetId })).ticket)}`);
    await left.getByRole('heading', { name: 'Fleet overview' }).waitFor();
    const elsewhere = await newPage();
    await elsewhere.goto(`/sign-in/ticket?ticket=${encodeURIComponent((await installation().operators.issueSignInTicket.mutate({ fleetId })).ticket)}`);
    await elsewhere.getByRole('heading', { name: 'Fleet overview' }).waitFor();

    await left.goto('/ships');

    await left.getByTestId('sign-in-signed-in-elsewhere').getByText('You signed in somewhere else').waitFor();
    await expect(left.getByTestId('sign-in-elsewhere-again').getAttribute('href')).resolves.toBe(hostedSignInUrl);
  });
});
