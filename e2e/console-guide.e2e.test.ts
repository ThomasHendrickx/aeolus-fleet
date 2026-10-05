import type { FleetId } from '@aeolus-fleet/common';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../packages/server/src/app.js';
import type { AppRouter } from '../packages/server/src/index.js';
import { FLEET_URL } from '../packages/server/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../packages/server/test/support/database.js';
import { newKey } from '../packages/server/test/support/keys.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';

// The installation's guide (decision 0024), end to end: set through the
// installation procedures, it opens by itself in a session of its audience,
// walks from page to page, points at its anchor or shows centred without one,
// hides after Skip or Finish, and Take the tour opens it again.

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
  await installation().guide.set.mutate({
    guide: {
      audience: 'viewers',
      steps: [
        { path: '/', anchor: 'header-search', title: 'Your fleet at a glance', text: 'Search ships or jump to any page.' },
        { path: '/inbox', anchor: 'no-such-element', title: 'Messages to argo', text: 'What the fleet sends the operator.' },
        { path: '/', title: 'That is all', text: 'Look around: nothing here can change the fleet.' },
      ],
    },
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

/** The one of a test id's elements this width shows: the desktop menu, not the phone sheet's trigger. */
function visible(page: Page, testId: string) {
  return page.locator(`[data-testid="${testId}"]:visible`);
}

describe('the guide', () => {
  it('opens by itself on the first page of a session of its audience, pointing at its anchor', async () => {
    const page = await signedIn('viewer');
    const step = page.getByTestId('tour-step');

    await step.getByText('Your fleet at a glance').waitFor();
    await expect.poll(() => step.getAttribute('data-placement')).toBe('anchored');
    await expect(page.getByTestId('tour-step-count').textContent()).resolves.toBe('1 of 3');
  });

  it('goes to the next step on its page, centred when its anchor is not there, and back again', async () => {
    const page = await signedIn('viewer');
    await page.getByTestId('tour-step-next').click();

    await page.waitForURL(/\/inbox$/);
    const step = page.getByTestId('tour-step');
    await step.getByText('Messages to argo').waitFor();
    await expect(step.getAttribute('data-placement')).resolves.toBe('centred');
    await expect(page.getByTestId('tour-step-count').textContent()).resolves.toBe('2 of 3');

    await page.getByTestId('tour-step-back').click();
    await page.waitForURL((url) => url.pathname === '/');
    await page.getByTestId('tour-step').getByText('Your fleet at a glance').waitFor();
  });

  it('stays hidden for the session after Skip, on every page and after a reload, until Take the tour', async () => {
    const page = await signedIn('viewer');
    await page.getByTestId('tour-step-skip').click();
    await page.getByTestId('tour-step').waitFor({ state: 'detached' });

    await page.reload();
    await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
    await page.goto('/inbox');
    await page.getByRole('heading', { name: 'Inbox' }).waitFor();
    await expect(page.getByTestId('tour-step').count()).resolves.toBe(0);

    await visible(page, 'account-menu').click();
    await visible(page, 'account-take-tour').click();
    await page.waitForURL((url) => url.pathname === '/');
    await page.getByTestId('tour-step').getByText('Your fleet at a glance').waitFor();
  });

  it('ends with Finish on its last step, and stays hidden', async () => {
    const page = await signedIn('viewer');
    await page.getByTestId('tour-step-next').click();
    await page.waitForURL(/\/inbox$/);
    await page.getByTestId('tour-step').getByText('Messages to argo').waitFor();
    await page.getByTestId('tour-step-next').click();
    await page.waitForURL((url) => url.pathname === '/');
    await page.getByTestId('tour-step').getByText('That is all').waitFor();
    await expect(page.getByTestId('tour-step-skip').count()).resolves.toBe(0);

    await page.getByTestId('tour-step-finish').click();
    await page.getByTestId('tour-step').waitFor({ state: 'detached' });
    await page.reload();
    await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();

    await expect(page.getByTestId('tour-step').count()).resolves.toBe(0);
  });

  it('shows the operator no guide set for viewers, and no Take the tour', async () => {
    const page = await signedIn('operator');
    await visible(page, 'account-menu').click();
    await visible(page, 'account-sign-out').waitFor();

    await expect(page.getByTestId('tour-step').count()).resolves.toBe(0);
    await expect(page.getByTestId('account-take-tour').count()).resolves.toBe(0);
  });
});
