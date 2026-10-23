import type { FleetId } from '@aeolus-fleet/common';
import { SCOPES } from '@aeolus-fleet/common';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Route } from 'playwright';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../packages/core/src/adapters/prisma/client.js';
import { createApp } from '../packages/core/src/app.js';
import type { AppRouter } from '../packages/core/src/index.js';
import { createUseCases } from '../packages/core/src/wiring.js';
import { FLEET_URL } from '../packages/core/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../packages/core/src/testing/database.js';
import { newKey } from '../packages/core/src/testing/keys.js';
import { unwrap } from '../packages/core/src/testing/result.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';

// Each part of a page asks its own read (performance design, decision 2): a
// fleet snapshot that never answers holds up the ship list only, and the
// overview's Stuck card still shows what it counts. The fleet has a ship
// besides argo, so the overview shows its cards.

const INSTALLATION_TOKEN = 'aeolus_installation_test_0123456789abcdef';
const SLOW_READ = 'fleet.list';

let database: PrismaClient;
let server: FastifyInstance;
let serverUrl: string;
let web: RunningWeb;
let browser: Browser;
let context: BrowserContext | undefined;
let fleetId: FleetId;
const held: Route[] = [];

function installation() {
  return createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${serverUrl}/trpc`, headers: { 'x-aeolus-installation-token': INSTALLATION_TOKEN } })] }).installation;
}

/** Whether a call to the server carries the slow read, alone or in a batch with others. */
function carriesSlowRead(url: URL): boolean {
  return url.pathname.split('/').at(-1)?.split(',').includes(SLOW_READ) ?? false;
}

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  const webUrl = await reserveWebUrl();
  server = createApp({ databaseUrl, publicUrl: FLEET_URL, consoleOrigin: webUrl, logger: false, installationToken: INSTALLATION_TOKEN });
  serverUrl = await server.listen({ host: '127.0.0.1', port: 0 });
  web = await startWeb({ url: webUrl, serverUrl });
  browser = await launchChromium();
  const created = await installation().fleets.create.mutate({ requestId: newKey(), name: 'harbour', operatorEmail: 'harbour@example.com' });
  fleetId = created.fleetId;
  const argo = { fleetId, shipId: created.operatorShipId, kind: 'operator' as const, scopes: [...SCOPES] };
  unwrap(await createUseCases({ prisma: database }).commissionShip(argo, { idempotencyKey: newKey(), name: 'builder', type: 'builder' }));
});

afterAll(async () => {
  await Promise.all(held.map((route) => route.abort()));
  await context?.close();
  await browser.close();
  await web.stop();
  await server.close();
  await database.$disconnect();
});

describe('a slow read', () => {
  it("holds up no other part: the overview's Stuck card shows while the fleet snapshot never answers", async () => {
    const { ticket } = await installation().operators.issueSignInTicket.mutate({ fleetId });
    context = await browser.newContext({ baseURL: web.url });
    await context.route(carriesSlowRead, (route) => {
      held.push(route);
    });
    const page = await context.newPage();

    await page.goto(`/sign-in/ticket?ticket=${encodeURIComponent(ticket)}`);

    await page.getByTestId('overview-stuck').getByText('Delivering').waitFor();
  });
});
