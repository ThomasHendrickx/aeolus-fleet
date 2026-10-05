import type { FleetId } from '@aeolus-fleet/common';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createApp } from '../packages/server/src/app.js';
import type { AppRouter } from '../packages/server/src/index.js';
import { FLEET_URL } from '../packages/server/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../packages/server/test/support/database.js';
import { newKey } from '../packages/server/test/support/keys.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';

// The console's analytics (decision 0025), end to end in the browser: with an
// adapter configured, the console posts its events to the web app's own
// /api/analytics, a pageview carrying the route's pattern and never an id,
// and the tour's moves as they happen. The browser's requests are caught
// here, so nothing reaches a provider; the route and the adapter have their
// own tests.

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
  web = await startWeb({
    url: webUrl,
    serverUrl,
    hostedAnalytics: { AEOLUS_HOSTED_ANALYTICS_PROVIDER: 'posthog', AEOLUS_HOSTED_ANALYTICS_KEY: 'phc_test', AEOLUS_HOSTED_ANALYTICS_HOST: 'https://analytics.invalid' },
  });
  browser = await launchChromium();
  ({ fleetId } = await installation().fleets.create.mutate({ requestId: newKey(), name: 'harbour', operatorEmail: 'harbour@example.com', viewer: true }));
  await installation().guide.set.mutate({
    guide: {
      audience: 'viewers',
      steps: [
        { path: '/', title: 'Your fleet at a glance', text: 'Search ships or jump to any page.' },
        { path: '/inbox', title: 'Messages to argo', text: 'What the fleet sends the operator.' },
        { path: '/', title: 'That is all', text: 'Look around.' },
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

/** A viewer session whose analytics requests are caught: every event the console posts, in order. */
async function aViewer(): Promise<{ page: Page; events: unknown[] }> {
  const { ticket } = await installation().operators.issueSignInTicket.mutate({ fleetId, as: 'viewer' });
  const context = await browser.newContext({ baseURL: web.url });
  contexts.push(context);
  const events: unknown[] = [];
  await context.route('**/api/analytics', async (route) => {
    events.push(JSON.parse(z.string().parse(route.request().postData())));
    await route.fulfill({ status: 204 });
  });
  const page = await context.newPage();
  await page.goto(`/sign-in/ticket?ticket=${encodeURIComponent(ticket)}`);
  await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
  return { page, events };
}

describe('the console analytics, switched on', () => {
  it("tracks each page as its route's pattern, never with an id in it", async () => {
    const { page, events } = await aViewer();
    await page.goto('/ships/shp_01m3tbfspe96yf1rnr4ank9h1a');

    await expect.poll(() => events).toContainEqual({ name: 'pageview', route: '/ships/[shipId]' });
    expect(JSON.stringify(events)).not.toContain('shp_01m3tbfspe96yf1rnr4ank9h1a');
  });

  it('tracks the tour: started when it opens, each step reached, and skipped', async () => {
    const { page, events } = await aViewer();
    await page.getByTestId('tour-step').getByText('Your fleet at a glance').waitFor();

    await page.getByTestId('tour-step-next').click();
    await page.waitForURL(/\/inbox$/);
    await page.getByTestId('tour-step-skip').click();

    await expect
      .poll(() => events.filter((event) => z.object({ name: z.string() }).parse(event).name !== 'pageview'))
      .toEqual([{ name: 'tour_started' }, { name: 'tour_step_reached', step: 2, total: 3 }, { name: 'tour_skipped', step: 2 }]);
  });
});
