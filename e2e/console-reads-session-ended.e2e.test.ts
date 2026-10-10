import { once } from 'node:events';
import { createServer, type Server } from 'node:http';

import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext } from 'playwright';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../packages/core/src/adapters/prisma/client.js';
import { createApp } from '../packages/core/src/app.js';
import { createUseCases } from '../packages/core/src/wiring.js';
import { FLEET_URL, OPERATOR } from '../packages/core/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../packages/core/test/support/database.js';
import { createTestClock } from '../packages/core/test/support/postgres-core.js';
import { unwrap } from '../packages/core/test/support/result.js';
import { signIn } from './support/console.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';

// A console page left open after its session ends, end to end (#544): the
// squadrons list is a console read asked again every few seconds, so once the
// session has expired the next read is refused for it and the page goes to
// sign in, without a navigation of its own. The server runs on a test clock,
// so the session expires without waiting 30 days.

const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_LIFETIME_MS = 30 * DAY_MS;
/** Two refresh cycles of the squadrons list (5 s each), with room for a slow compile. */
const WITHIN_MS = 15_000;
const clock = createTestClock(new Date().toISOString());

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
let context: BrowserContext | undefined;

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
  await context?.close();
  await browser.close();
  await web.stop();
  squadrons.close();
  await server.close();
  await database.$disconnect();
});

describe('a console page whose session ended', () => {
  it('goes to sign in once a read it asks again is refused for the ended session', async () => {
    context = await browser.newContext({ baseURL: web.url });
    const page = await context.newPage();
    await signIn(page, OPERATOR);
    await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
    await page.goto('/squadrons');
    await page.getByText('No blueprints found').waitFor();

    clock.advance(SESSION_LIFETIME_MS);

    await page.waitForURL(`${web.url}/sign-in`, { timeout: WITHIN_MS });
  });
});
