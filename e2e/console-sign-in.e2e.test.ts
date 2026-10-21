import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../packages/core/src/adapters/prisma/client.js';
import { createApp } from '../packages/core/src/app.js';
import { runServerCommand } from '../packages/core/test/support/commands.js';
import { giveOperatorLogin } from '../packages/core/test/support/operator-login.js';
import { FLEET_URL, OPERATOR } from '../packages/core/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../packages/core/src/testing/database.js';
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
/** The one-use link fleet:init printed. */
let signInLink: string;

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  const webUrl = await reserveWebUrl();
  const init = await runServerCommand({
    script: 'fleet:init',
    args: ['--name', 'home fleet'],
    env: { DATABASE_URL: databaseUrl, PUBLIC_URL: FLEET_URL, CONSOLE_ORIGIN: webUrl },
  });
  if (init.code !== 0) {
    throw new Error(`fleet:init failed with ${String(init.code)}:\n${init.stderr}`);
  }
  signInLink = /Open (\S+) to sign in/.exec(init.stdout)?.[1] ?? '';

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

describe('the first run, self-hosted: the link fleet:init printed', () => {
  it('signs in as argo, and the account menu says so with no email yet; Settings asks no current password', async () => {
    const page = await newPage();

    await page.goto(signInLink);

    await expectSignedIn(page);
    await page.locator('[data-testid="avatar-menu"]:visible').click();
    await page.locator('[data-testid="avatar-menu-signed-in-as"]:visible', { hasText: 'Signed in as argo' }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-sign-in-state').filter({ hasText: 'npx aeolus-core sign-in' }).waitFor();
    await expect(page.getByTestId('settings-sign-in').getByLabel('Current password').count()).resolves.toBe(0);
  });

  it('says on the sign-in page how to get a link without a password', async () => {
    const page = await newPage();

    await page.goto('/sign-in');

    await page.getByText('No password yet, or forgot it? Get a sign-in link on the server with aeolus-core sign-in').waitFor();
  });

  it('says the link has expired once it was used, and how to get a new one', async () => {
    const page = await newPage();

    await page.goto(signInLink);

    await page.waitForURL(`${web.url}/sign-in/failed`);
    await page.getByText('This link has expired. Run npx aeolus-core sign-in for a new one.').waitFor();
    await expect(page.context().cookies()).resolves.toEqual([]);
  });
});

describe('the console sign-in', () => {
  beforeAll(async () => {
    // As Settings would set them: the email and password these tests sign in with.
    const { fleetId, id: operatorId } = await database.operator.findFirstOrThrow();
    await giveOperatorLogin(database, { fleetId, operatorId });
  });

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

  it("signs in with argo's own email and password, keeping only an httpOnly, Secure, SameSite=Strict session cookie", async () => {
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

  it('says sign-in needs https on a page the browser does not treat as a secure context', async () => {
    const page = await newPage();
    // As over plain http on a host beyond localhost, where the browser would drop the Secure cookie without a word.
    await page.addInitScript("Object.defineProperty(window, 'isSecureContext', { value: false });");

    await page.goto('/sign-in');

    await page.getByTestId('sign-in-insecure-context').getByText('Sign-in needs https').waitFor();
  });

  it('says nothing of https on a secure context, such as localhost', async () => {
    const page = await newPage();
    await page.goto('/sign-in');

    await page.getByRole('button', { name: 'Sign in' }).and(page.locator(':enabled')).waitFor();
    await expect(page.getByTestId('sign-in-insecure-context').count()).resolves.toBe(0);
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

  it('says the operator signed in somewhere else when a page load is the first to hear it', async () => {
    const first = await newPage();
    await signIn(first, OPERATOR);
    await expectSignedIn(first);
    const endedSession = await first.context().cookies();
    await first.close();
    const second = await newPage();
    await signIn(second, OPERATOR);
    await expectSignedIn(second);
    const context = await browser.newContext({ baseURL: web.url });
    contexts.push(context);
    await context.addCookies(endedSession);
    const page = await context.newPage();

    await page.goto('/ships');

    await page.waitForURL(`${web.url}/sign-in?notice=signed-in-elsewhere`);
    await page.getByTestId('sign-in-signed-in-elsewhere').getByText('You signed in somewhere else').waitFor();
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
    await page.locator('[data-testid="avatar-menu"]:visible').click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();

    await page.waitForURL(`${web.url}/sign-in`);
    await expect(page.context().cookies()).resolves.toEqual([]);
    await expectSentToSignIn(page);
  });
});

describe("argo's own email and password, set in Settings", () => {
  it('asks the current password first, then signs in with the new email and password, and no longer with the old', async () => {
    const changed = { email: 'mathilde@example.com', password: 'staple battery horse' };
    const page = await newPage();
    await signIn(page, OPERATOR);
    await expectSignedIn(page);

    await page.getByTestId('nav-settings').click();
    const section = page.getByTestId('settings-sign-in');
    await expect(section.getByLabel('Email').inputValue()).resolves.toBe(OPERATOR.email);
    await section.getByLabel('Email').fill(changed.email);
    await section.getByLabel('New password').fill(changed.password);
    await section.getByLabel('Repeat the password').fill(changed.password);
    await section.getByLabel('Current password').fill('not the password at all');
    await section.getByTestId('settings-sign-in-save').click();
    await section.getByText('That is not your current password').waitFor();
    await section.getByLabel('Current password').fill(OPERATOR.password);
    await section.getByTestId('settings-sign-in-save').click();
    await page.getByTestId('settings-sign-in-saved').waitFor();

    const old = await newPage();
    await signIn(old, OPERATOR);
    await old.getByRole('main').getByRole('alert').waitFor();
    const next = await newPage();
    await signIn(next, changed);
    await expectSignedIn(next);

    // Back to the login the other tests sign in with.
    await next.goto('/settings');
    await next.getByTestId('settings-sign-in').getByLabel('Email').fill(OPERATOR.email);
    await next.getByTestId('settings-sign-in').getByLabel('New password').fill(OPERATOR.password);
    await next.getByTestId('settings-sign-in').getByLabel('Repeat the password').fill(OPERATOR.password);
    await next.getByTestId('settings-sign-in').getByLabel('Current password').fill(changed.password);
    await next.getByTestId('settings-sign-in-save').click();
    await next.getByTestId('settings-sign-in-saved').waitFor();
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
