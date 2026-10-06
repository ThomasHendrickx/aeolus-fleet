import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../packages/core/src/adapters/prisma/client.js';
import { createApp } from '../packages/core/src/app.js';
import { runServerCommand } from '../packages/core/test/support/commands.js';
import { FLEET_URL, OPERATOR } from '../packages/core/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../packages/core/test/support/database.js';
import { createTestClock } from '../packages/core/test/support/postgres-core.js';
import { signIn } from './support/console.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';

// Signing in to the console, end to end: fleet:init as the operator runs it,
// then a browser, the web app, the server and Postgres. The server runs in
// this process on a test clock, so a session can expire without waiting 30
// days.

const DAY_MS = 24 * 60 * 60 * 1000;
const clock = createTestClock('2026-09-29T12:00:00.000Z');

let database: PrismaClient;
let server: FastifyInstance;
let web: RunningWeb;
let browser: Browser;
const contexts: BrowserContext[] = [];

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  const init = await runServerCommand({
    script: 'fleet:init',
    args: ['--name', 'home fleet'],
    answers: [OPERATOR.email, OPERATOR.password, OPERATOR.password],
    env: { DATABASE_URL: databaseUrl, PUBLIC_URL: FLEET_URL },
  });
  if (init.code !== 0) {
    throw new Error(`fleet:init failed with ${String(init.code)}:\n${init.stderr}`);
  }

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

async function newPage(): Promise<Page> {
  const context = await browser.newContext({ baseURL: web.url });
  contexts.push(context);
  return context.newPage();
}

async function expectSignedIn(page: Page): Promise<void> {
  await page.waitForURL(`${web.url}/`);
  await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
}

async function expectSentToSignIn(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForURL(`${web.url}/sign-in`);
}

describe('the console sign-in', () => {
  it.each([
    ['a wrong password', { email: OPERATOR.email, password: 'wrong horse' }],
    ['an unknown email', { email: 'stranger@example.com', password: OPERATOR.password }],
  ])('refuses %s with the same words and keeps the operator on the sign-in page without a session', async (_label, login) => {
    const page = await newPage();

    await signIn(page, login);

    // Scoped to main: Next's route announcer is an alert too.
    const alert = page.getByRole('main').getByRole('alert');
    await alert.waitFor();
    await expect(alert.textContent()).resolves.toBe('Wrong email or password.');
    expect(page.url()).toBe(`${web.url}/sign-in`);
    await expect(page.getByLabel('Email').inputValue()).resolves.toBe(login.email);
    await expect(page.context().cookies()).resolves.toEqual([]);
  });

  it('signs in with the email and password fleet:init was given, keeping only an httpOnly, Secure, SameSite=Strict session cookie', async () => {
    const page = await newPage();

    await signIn(page, OPERATOR);

    await expectSignedIn(page);
    await page.getByRole('row', { name: /argo/ }).waitFor();
    const cookies = await page.context().cookies();
    expect(cookies).toEqual([
      expect.objectContaining({ name: 'aeolus_session', httpOnly: true, secure: true, sameSite: 'Strict', path: '/' }),
    ]);
    expect(cookies[0]?.value).not.toContain(OPERATOR.password);
    await expect(page.evaluate('document.cookie')).resolves.toBe('');
  });

  it('asks for an email and a password, and never for a secret', async () => {
    const page = await newPage();
    await page.goto('/sign-in');

    await page.getByLabel('Email').waitFor();
    await expect(page.getByLabel('Password').getAttribute('type')).resolves.toBe('password');
    await expect(page.getByText(/secret/i).count()).resolves.toBe(0);
  });

  it('shows the app mark as the favicon, an SVG with a dark variant', async () => {
    const page = await newPage();
    await page.goto('/sign-in');

    const href = await page.locator('link[rel="icon"]').first().getAttribute('href');
    const icon = await fetch(new URL(href ?? '/missing', web.url));

    expect(icon.headers.get('content-type')).toContain('image/svg+xml');
    await expect(icon.text()).resolves.toContain('prefers-color-scheme: dark');
  });

  it('sends a visitor without a session to the sign-in page', async () => {
    const page = await newPage();

    await expectSentToSignIn(page);
  });

  it('redirects a console page asked for without a live session on the server, before any of the console renders', async () => {
    for (const cookie of [undefined, 'aeolus_session=forged']) {
      const response = await fetch(`${web.url}/ships`, { redirect: 'manual', headers: cookie === undefined ? {} : { cookie } });

      expect(response.status).toBeGreaterThanOrEqual(300);
      expect(response.status).toBeLessThan(400);
      expect(new URL(response.headers.get('location') ?? '', web.url).href).toBe(`${web.url}/sign-in`);
    }
  });

  it('ends the first session when the operator signs in again elsewhere', async () => {
    const first = await newPage();
    await signIn(first, OPERATOR);
    await expectSignedIn(first);
    const second = await newPage();

    await signIn(second, OPERATOR);
    await expectSignedIn(second);

    // Without a reload: the first console hears its session end, and says why, calmly.
    await first.waitForURL(`${web.url}/sign-in?notice=signed-in-elsewhere`);
    await first.getByTestId('sign-in-signed-in-elsewhere').getByText('You signed in somewhere else').waitFor();
    await second.reload();
    await second.getByRole('heading', { name: 'Fleet overview' }).waitFor();
  });

  it('sends the operator back to sign in once the session has expired', async () => {
    const page = await newPage();
    await signIn(page, OPERATOR);
    await expectSignedIn(page);

    clock.advance(30 * DAY_MS);

    await expectSentToSignIn(page);
  });

  it('signs out: the session ends and the console needs a new sign-in', async () => {
    const page = await newPage();
    await signIn(page, OPERATOR);
    await expectSignedIn(page);

    // The Sidebar's account button on desktop; the phone TopBar's Avatar is hidden.
    await page.locator('[data-testid="account-menu"]:visible').click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();

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
