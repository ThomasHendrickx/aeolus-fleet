import { once } from 'node:events';
import { createServer, type Server } from 'node:http';

import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Page, WebSocketRoute } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../packages/core/src/adapters/prisma/client.js';
import { createApp } from '../packages/core/src/app.js';
import { createUseCases } from '../packages/core/src/wiring.js';
import { FLEET_URL, OPERATOR } from '../packages/core/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../packages/core/src/testing/database.js';
import { createTestClock } from '../packages/core/test/support/postgres-core.js';
import { unwrap } from '../packages/core/src/testing/result.js';
import { signIn } from './support/console.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';

// A console page left open after its session ends, end to end (#544, #555):
// the squadrons list is a console read asked again every few seconds, so once
// the session has expired, or the operator signed in somewhere else, the next
// read is refused for it and the page goes to sign in, without a navigation
// of its own. The server runs on a test clock, so the session expires without
// waiting 30 days.

const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_LIFETIME_MS = 30 * DAY_MS;
/** Two refresh cycles of the squadrons list (5 s each), with room for a slow compile. */
const WITHIN_MS = 15_000;
const UNAUTHORIZED = 401;
const clock = createTestClock(new Date().toISOString());
/** How long the sign-in page takes to answer: a slow way out. */
const SLOW_WAY_OUT_MS = 2_000;
/** How long after leaving the calls the page sends are watched. */
const AFTER_LEAVING_MS = 3_000;
/** How long a page's live subscription waits before it reaches the server: longer than the page takes to show its reads. */
const LATE_LIVE_MS = 2_000;

/** A squadrons that is connected and has no squadron and no blueprint. */
function aConnectedSquadrons(): Server {
  const answers: Record<string, unknown> = {
    'connection.status': { enabled: true, state: 'connected', ship: { shipId: 'shp_01m4k000000000000000000000', name: 'squadrons' }, lastShipId: null },
    'squadrons.list': [],
    'catalogue.list': { templates: [], blueprints: [], problems: [] },
  };
  return createServer((request, response) => {
    const procedure = new URL(request.url ?? '/', 'http://squadrons').pathname.replace('/trpc/', '');
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(procedure in answers ? { result: { data: answers[procedure] } } : { error: { message: `no ${procedure} here` } }));
  });
}

let database: PrismaClient;
let server: FastifyInstance;
const squadrons = aConnectedSquadrons();
let web: RunningWeb;
let browser: Browser;
const contexts: BrowserContext[] = [];

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  unwrap(await createUseCases({ prisma: database, clock }).initialiseFleet({ name: 'home fleet', ...OPERATOR }));
  const webUrl = await reserveWebUrl();
  server = createApp({ databaseUrl, publicUrl: FLEET_URL, consoleOrigin: webUrl, clock, logger: false });
  const serverUrl = await server.listen({ host: '127.0.0.1', port: 0 });
  squadrons.listen(0, '127.0.0.1');
  await once(squadrons, 'listening');
  const address = squadrons.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the squadrons has no port');
  }
  web = await startWeb({ url: webUrl, serverUrl, squadronsUrl: `http://127.0.0.1:${String(address.port)}` });
  browser = await launchChromium();
});

afterAll(async () => {
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
  await web.stop();
  squadrons.close();
  await server.close();
  await database.$disconnect();
});

async function aSignedInPage(): Promise<Page> {
  const context = await browser.newContext({ baseURL: web.url });
  contexts.push(context);
  const page = await context.newPage();
  await signIn(page, OPERATOR);
  await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
  return page;
}

/**
 * A signed-in squadrons page whose console reads are the only way to hear the
 * session ended: its live subscription's WebSocket opens but stays silent,
 * and once the page shows, every tRPC call over HTTP fails without an answer,
 * so neither can send the page to sign in.
 */
async function aSquadronsPageHearingOnlyItsReads(): Promise<Page> {
  const page = await aSignedInPage();
  await page.routeWebSocket(/\/trpc/, () => undefined);
  await page.goto('/squadrons');
  await page.getByText('No blueprints found').waitFor();
  await page.route(/\/trpc\//, (route) => route.abort());
  return page;
}

/**
 * Holds the page's live subscription for a while before it reaches the
 * server, as a slow WebSocket does: what the page sends meanwhile waits and
 * goes once the server is reached.
 */
async function holdLiveSubscription(page: Page): Promise<void> {
  await page.routeWebSocket(/\/trpc$/, (socket) => {
    const waiting: (string | Buffer)[] = [];
    let server: WebSocketRoute | undefined;
    socket.onMessage((message) => {
      if (server === undefined) {
        waiting.push(message);
      } else {
        server.send(message);
      }
    });
    setTimeout(() => {
      const reached = socket.connectToServer();
      for (const message of waiting.splice(0)) {
        reached.send(message);
      }
      server = reached;
    }, LATE_LIVE_MS);
  });
}

/** A signed-in page on the squadrons list, whose reads ask again every few seconds; its live subscription comes late when asked. */
async function aSquadronsPage({ isLiveLate = false }: { isLiveLate?: boolean } = {}): Promise<Page> {
  const page = await aSignedInPage();
  if (isLiveLate) {
    await holdLiveSubscription(page);
  }
  await page.goto('/squadrons');
  await page.getByText('No blueprints found').waitFor();
  // Live once the server started the subscription, with the session still valid: from then only a read can hear it ended.
  await page.getByRole('banner').getByText('Live', { exact: true }).waitFor();
  return page;
}

describe('a console page whose session ended', () => {
  it('goes to sign in once a read it asks again is refused for the ended session', async () => {
    const page = await aSquadronsPage();

    clock.advance(SESSION_LIFETIME_MS);

    await page.waitForURL(`${web.url}/sign-in`, { timeout: WITHIN_MS });
  });

  it('goes to sign in once, however many of its reads are refused for the ended session', async () => {
    const page = await aSquadronsPage();
    let timesLeft = 0;
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/sign-in') {
        timesLeft += 1;
      }
    });

    clock.advance(SESSION_LIFETIME_MS);
    await page.waitForURL(`${web.url}/sign-in`, { timeout: WITHIN_MS });
    await new Promise((resolve) => setTimeout(resolve, AFTER_LEAVING_MS));

    expect(timesLeft).toBe(1);
  });

  it('says the operator signed in somewhere else when a read it asks again is the only one to hear it', async () => {
    const page = await aSquadronsPageHearingOnlyItsReads();
    const refusedRead = page.waitForResponse((response) => new URL(response.url()).pathname.startsWith('/api/reads/') && response.status() === UNAUTHORIZED, { timeout: WITHIN_MS });

    await aSignedInPage();

    await refusedRead;
    await page.waitForURL(`${web.url}/sign-in?notice=signed-in-elsewhere`, { timeout: WITHIN_MS });
    await page.getByTestId('sign-in-signed-in-elsewhere').getByText('You signed in somewhere else').waitFor();
  });

  it('sends no call on its way to sign in once a read is refused for the ended session, while the way to sign in is slow', async () => {
    // A live subscription that comes late must not be the call that hears the session ended (#645).
    const page = await aSquadronsPage({ isLiveLate: true });
    let isRefused = false;
    // The page asks for sign in only once it holds its calls (lib/session.ts); a call the page sent before it handled the refusal is not one on its way out (#702).
    let isLeaving = false;
    const callsWhileLeaving: string[] = [];
    page.on('response', (response) => {
      if (response.status() === UNAUTHORIZED) {
        isRefused = true;
      }
    });
    page.on('request', (request) => {
      const { pathname } = new URL(request.url());
      if (pathname === '/sign-in') {
        isLeaving = true;
      }
      if (isLeaving && (pathname.startsWith('/trpc/') || pathname.startsWith('/api/reads/'))) {
        callsWhileLeaving.push(pathname);
      }
    });
    await page.route(
      (url) => url.pathname === '/sign-in',
      async (route) => {
        await new Promise((resolve) => setTimeout(resolve, SLOW_WAY_OUT_MS));
        await route.continue();
      },
    );

    clock.advance(SESSION_LIFETIME_MS);
    await expect.poll(() => isRefused && isLeaving, { timeout: WITHIN_MS }).toBe(true);
    // Coming back to the page while it is on its way out asks its reads again; TanStack Query hears it on window.
    await page.evaluate("window.dispatchEvent(new Event('visibilitychange'))");
    await page.waitForURL(`${web.url}/sign-in`, { timeout: WITHIN_MS });
    await new Promise((resolve) => setTimeout(resolve, AFTER_LEAVING_MS));

    expect(callsWhileLeaving).toEqual([]);
  });
});
