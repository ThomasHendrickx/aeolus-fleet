import { once } from 'node:events';
import { createServer, type Server } from 'node:http';

import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../packages/core/src/adapters/prisma/client.js';
import { createApp } from '../packages/core/src/app.js';
import { createUseCases } from '../packages/core/src/wiring.js';
import { FLEET_URL, OPERATOR } from '../packages/core/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../packages/core/test/support/database.js';
import { createTestClock } from '../packages/core/test/support/postgres-core.js';
import { unwrap } from '../packages/core/test/support/result.js';
import { signIn } from './support/console.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';

// Reads beside a slow mutation, end to end (#433): Next.js runs a browser's
// server functions one at a time, so a read through one would wait for a
// mutation still running. A squadrons that holds Refresh catalogue open shows
// whether the squadrons list, asked again every few seconds, still reaches it
// meanwhile.

const clock = createTestClock(new Date().toISOString());
/** Two refresh cycles of the squadrons list (5 s each), with room for a slow first compile. */
const WITHIN_MS = 15_000;
const SAMPLE_EVERY_MS = 250;

/**
 * A squadrons that is connected, has one repository and no squadron, and
 * holds every Refresh catalogue open until released. It counts the squadrons
 * list asked of it.
 */
function aSlowSquadrons() {
  let listCount = 0;
  const held: (() => void)[] = [];
  const answers: Record<string, unknown> = {
    'connection.status': { enabled: true, state: 'connected', ship: { shipId: 'shp_01m4k000000000000000000000', name: 'squadrons' }, lastShipId: null },
    'squadrons.list': [],
    'catalogue.list': { templates: [], blueprints: [], problems: [] },
    'repositories.list': [{ name: 'templates', url: 'https://github.com/acme/templates', path: '', hasToken: false, addedAt: '2026-10-01T12:00:00.000Z', lastFetch: null }],
  };
  const server: Server = createServer((request, response) => {
    const procedure = new URL(request.url ?? '/', 'http://squadrons').pathname.replace('/trpc/', '');
    const answer = (data: unknown) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ result: { data } }));
    };
    if (procedure === 'catalogue.refresh') {
      held.push(() => {
        answer({});
      });
      return;
    }
    if (procedure === 'squadrons.list') {
      listCount += 1;
    }
    if (procedure in answers) {
      answer(answers[procedure]);
      return;
    }
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ error: { message: `no ${procedure} here` } }));
  });
  return {
    server,
    listCount: () => listCount,
    /** Whether a Refresh catalogue is held open right now. */
    isRefreshing: () => held.length > 0,
    release: () => {
      held.splice(0).forEach((finish) => {
        finish();
      });
    },
  };
}

async function waitUntil(isMet: () => boolean, withinMs: number): Promise<boolean> {
  const deadline = Date.now() + withinMs;
  while (Date.now() < deadline) {
    if (isMet()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, SAMPLE_EVERY_MS));
  }
  return isMet();
}

let database: PrismaClient;
let server: FastifyInstance;
const squadrons = aSlowSquadrons();
let web: RunningWeb;
let browser: Browser;
let context: BrowserContext | undefined;

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  unwrap(await createUseCases({ prisma: database, clock }).initialiseFleet({ name: 'home fleet', ...OPERATOR }));
  const webUrl = await reserveWebUrl();
  server = createApp({ databaseUrl, publicUrl: FLEET_URL, consoleOrigin: webUrl, clock, logger: false });
  const serverUrl = await server.listen({ host: '127.0.0.1', port: 0 });
  squadrons.server.listen(0, '127.0.0.1');
  await once(squadrons.server, 'listening');
  const address = squadrons.server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the slow squadrons has no port');
  }
  web = await startWeb({ url: webUrl, serverUrl, squadronsUrl: `http://127.0.0.1:${String(address.port)}` });
  browser = await launchChromium();
});

afterAll(async () => {
  squadrons.release();
  await context?.close();
  await browser.close();
  await web.stop();
  squadrons.server.close();
  await server.close();
  await database.$disconnect();
});

describe('reads beside a slow mutation', () => {
  it('asks the squadrons list again while Refresh catalogue still runs', async () => {
    context = await browser.newContext({ baseURL: web.url });
    const page = await context.newPage();
    await signIn(page, OPERATOR);
    await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
    await page.goto('/settings');
    const refresh = page.getByTestId('repositories-refresh');
    await refresh.and(page.locator(':enabled')).waitFor();

    await refresh.click();
    await expect(waitUntil(squadrons.isRefreshing, WITHIN_MS)).resolves.toBe(true);
    const listedBefore = squadrons.listCount();

    await expect(waitUntil(() => squadrons.listCount() > listedBefore, WITHIN_MS)).resolves.toBe(true);
    expect(squadrons.isRefreshing()).toBe(true);
  });
});
