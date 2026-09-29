import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../packages/server/src/adapters/prisma/client.js';
import { createApp } from '../packages/server/src/app.js';
import { createUseCases } from '../packages/server/src/wiring.js';
import { createMigratedDatabase } from '../packages/server/test/support/database.js';
import { createTestClock } from '../packages/server/test/support/postgres-core.js';
import { launchChromium, startWeb, type RunningWeb } from './support/web.js';

// Signing in to the console, end to end: a browser, the web app, the server and
// Postgres. The server runs in this process on a test clock, so a session can
// expire without waiting 30 days.

const DAY_MS = 24 * 60 * 60 * 1000;
const clock = createTestClock('2026-09-29T12:00:00.000Z');

let database: PrismaClient;
let server: FastifyInstance;
let web: RunningWeb;
let browser: Browser;
let secret: string;
const contexts: BrowserContext[] = [];

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  ({ secret } = await createUseCases({ prisma: database, clock }).initialiseFleet({ name: 'home fleet' }));

  server = createApp({ databaseUrl, clock, logger: false });
  const serverUrl = await server.listen({ host: '127.0.0.1', port: 0 });
  web = await startWeb(serverUrl);
  browser = await launchChromium();
});

afterAll(async () => {
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
  await web.stop();
  await server.close();
  await database.$disconnect();
});

async function newPage(): Promise<Page> {
  const context = await browser.newContext({ baseURL: web.url });
  contexts.push(context);
  return context.newPage();
}

async function signIn(page: Page, withSecret: string): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel("argo's secret").fill(withSecret);
  const button = page.getByRole('button', { name: 'Sign in' });
  await button.and(page.locator(':enabled')).waitFor();
  await button.click();
}

async function expectSignedIn(page: Page): Promise<void> {
  await page.waitForURL(`${web.url}/`);
  await page.getByText('Signed in as argo.').waitFor();
}

async function expectSentToSignIn(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForURL(`${web.url}/sign-in`);
}

describe('the console sign-in', () => {
  it('refuses a wrong secret and keeps the operator on the sign-in page without a session', async () => {
    const page = await newPage();

    await signIn(page, 'aeolus_sk_v1_wrong');

    // Scoped to main: Next's route announcer is an alert too.
    const alert = page.getByRole('main').getByRole('alert');
    await alert.waitFor();
    await expect(alert.textContent()).resolves.toBe('That secret is not valid.');
    expect(page.url()).toBe(`${web.url}/sign-in`);
    await expect(page.context().cookies()).resolves.toEqual([]);
  });

  it("signs in with argo's secret, keeping only an httpOnly, Secure, SameSite=Strict session cookie", async () => {
    const page = await newPage();

    await signIn(page, secret);

    await expectSignedIn(page);
    await expect(page.getByText('2026').first().isVisible()).resolves.toBe(true);
    const cookies = await page.context().cookies();
    expect(cookies).toEqual([
      expect.objectContaining({ name: 'aeolus_session', httpOnly: true, secure: true, sameSite: 'Strict', path: '/' }),
    ]);
    expect(cookies[0]?.value).not.toContain(secret);
    await expect(page.evaluate('document.cookie')).resolves.toBe('');
  });

  it('sends a visitor without a session to the sign-in page', async () => {
    const page = await newPage();

    await expectSentToSignIn(page);
  });

  it('ends the first session when the operator signs in a second time', async () => {
    const first = await newPage();
    await signIn(first, secret);
    await expectSignedIn(first);
    const second = await newPage();

    await signIn(second, secret);
    await expectSignedIn(second);

    await expectSentToSignIn(first);
    await second.reload();
    await second.getByText('Signed in as argo.').waitFor();
  });

  it('sends the operator back to sign in once the session has expired', async () => {
    const page = await newPage();
    await signIn(page, secret);
    await expectSignedIn(page);

    clock.advance(30 * DAY_MS);

    await expectSentToSignIn(page);
  });

  it('signs out: the session ends and the console needs a new sign-in', async () => {
    const page = await newPage();
    await signIn(page, secret);
    await expectSignedIn(page);

    await page.getByRole('button', { name: 'Sign out' }).click();

    await page.waitForURL(`${web.url}/sign-in`);
    await expect(page.context().cookies()).resolves.toEqual([]);
    await expectSentToSignIn(page);
  });
});

describe('the health endpoints', () => {
  it('report web, server and database up, and nothing about fleets', async () => {
    const webHealth = await fetch(`${web.url}/health`);
    const serverHealth = await server.inject({ method: 'GET', url: '/health' });

    expect(webHealth.status).toBe(200);
    await expect(webHealth.json()).resolves.toEqual({ web: 'up', server: 'up', database: 'up' });
    expect(serverHealth.json()).toEqual({ server: 'up', database: 'up' });
  });
});
