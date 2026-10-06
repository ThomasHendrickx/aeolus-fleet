import type { FleetId } from '@aeolus-fleet/common';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../packages/core/src/app.js';
import type { AppRouter } from '../packages/core/src/index.js';
import { FLEET_URL } from '../packages/core/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../packages/core/test/support/database.js';
import { newKey } from '../packages/core/test/support/keys.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';

// The installation's notices (decision 0023), end to end: set through the
// installation procedures, shown above the console to the sessions of their
// audience, dismissed per session, and a link that signs out.

const INSTALLATION_TOKEN = 'aeolus_installation_test_0123456789abcdef';

let server: FastifyInstance;
let serverUrl: string;
let web: RunningWeb;
let browser: Browser;
const contexts: BrowserContext[] = [];
let fleetId: FleetId;

function installation() {
  return createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${serverUrl}/trpc`, headers: { 'x-aeolus-installation-token': INSTALLATION_TOKEN } })] }).installation;
}

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  const webUrl = await reserveWebUrl();
  server = createApp({ databaseUrl, publicUrl: FLEET_URL, consoleOrigin: webUrl, logger: false, installationToken: INSTALLATION_TOKEN });
  serverUrl = await server.listen({ host: '127.0.0.1', port: 0 });
  web = await startWeb({ url: webUrl, serverUrl });
  browser = await launchChromium();
  const created = await installation().fleets.create.mutate({ requestId: newKey(), name: 'harbour', operatorEmail: 'harbour@example.com', viewer: true });
  fleetId = created.fleetId;
  await installation().notices.set.mutate({
    notices: [
      { id: 'maintenance', audience: 'everyone', text: 'Maintenance on Saturday at 06:00 UTC.' },
      { id: 'billing', audience: 'operators', text: 'Your plan renews next week.' },
      {
        id: 'read-only',
        audience: 'viewers',
        text: 'You are looking at this fleet read-only.',
        links: [{ label: 'Leave', isSignOut: true }],
        isDismissible: true,
      },
    ],
  });
});

afterAll(async () => {
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
  await web.stop();
  await server.close();
});

async function signedIn(as: 'operator' | 'viewer'): Promise<Page> {
  const { ticket } = await installation().operators.issueSignInTicket.mutate({ fleetId, as });
  const context = await browser.newContext({ baseURL: web.url });
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(`/sign-in/ticket?ticket=${encodeURIComponent(ticket)}`);
  await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
  return page;
}

function notice(page: Page, id: string) {
  return page.locator(`[data-testid="notice"][data-notice-id="${id}"]`);
}

describe('the notices above the console', () => {
  it("shows a viewer session the notices for everyone and for viewers, not the operators'", async () => {
    const page = await signedIn('viewer');

    await page.getByText('You are looking at this fleet read-only.').waitFor();
    await page.getByText('Maintenance on Saturday at 06:00 UTC.').waitFor();
    await expect(page.getByText('Your plan renews next week.').count()).resolves.toBe(0);
  });

  it("shows the operator the notices for everyone and for operators, not the viewers'", async () => {
    const page = await signedIn('operator');

    await page.getByText('Your plan renews next week.').waitFor();
    await page.getByText('Maintenance on Saturday at 06:00 UTC.').waitFor();
    await expect(page.getByText('You are looking at this fleet read-only.').count()).resolves.toBe(0);
  });

  it('offers no Dismiss on a notice that is not dismissible', async () => {
    const page = await signedIn('viewer');
    await notice(page, 'maintenance').waitFor();

    await expect(notice(page, 'maintenance').getByTestId('notice-dismiss').count()).resolves.toBe(0);
  });

  it('keeps a dismissed notice away for that session, on every page and after a reload', async () => {
    const page = await signedIn('viewer');

    await notice(page, 'read-only').getByTestId('notice-dismiss').click();
    await notice(page, 'read-only').waitFor({ state: 'detached' });
    await page.goto('/inbox');
    await notice(page, 'maintenance').waitFor();

    await expect(notice(page, 'read-only').count()).resolves.toBe(0);
  });

  it('ends the session through a link that signs out, and goes to sign in', async () => {
    const page = await signedIn('viewer');

    await notice(page, 'read-only').getByRole('button', { name: 'Leave' }).click();
    await page.waitForURL(/\/sign-in/);
    await page.goto('/');

    await page.waitForURL(/\/sign-in/);
  });
});
