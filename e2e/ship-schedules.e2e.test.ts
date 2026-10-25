import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createPrismaClient, type PrismaClient } from '../packages/core/src/adapters/prisma/client.js';
import { createApp } from '../packages/core/src/app.js';
import type { ShipCaller } from '../packages/core/src/domain/shared/caller.js';
import { createUseCases, type UseCases } from '../packages/core/src/wiring.js';
import { FLEET_URL, OPERATOR, operatorCaller, secretOf } from '../packages/core/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../packages/core/src/testing/database.js';
import { createTestClock } from '../packages/core/test/support/postgres-core.js';
import { unwrap } from '../packages/core/src/testing/result.js';
import { signIn } from './support/console.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';
import { newKey } from '../packages/core/src/testing/keys.js';
import { withOperatorLogin } from '../packages/core/test/support/operator-login.js';

// A ship's schedules on its page, end to end (decision 0062, S15): a ship
// schedules a message over the REST API as its session would, and argo sees
// it on the ship page's Schedules tab, pauses it and cancels it, each shown
// in the row and in the ship's timeline.

const clock = createTestClock('2026-10-25T09:00:00.000Z');

let database: PrismaClient;
let useCases: UseCases;
let argo: ShipCaller;
let server: FastifyInstance;
let serverUrl: string;
let web: RunningWeb;
let browser: Browser;
const contexts: BrowserContext[] = [];

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  useCases = createUseCases({ prisma: database, clock });
  argo = operatorCaller(unwrap(await withOperatorLogin(database, useCases.initialiseFleet({ name: 'home fleet' }))));

  const webUrl = await reserveWebUrl();
  server = createApp({ databaseUrl, publicUrl: FLEET_URL, consoleOrigin: webUrl, clock, logger: false });
  serverUrl = await server.listen({ host: '127.0.0.1', port: 0 });
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

/** Commissions a ship and crews it over REST; answers its id and a caller with its crew token. */
async function crewedOverRest(ship: { name: string; type: string }) {
  const { shipId, secret } = unwrap(await useCases.commissionShip(argo, { ...ship, idempotencyKey: newKey() }));
  const registered = await fetch(`${serverUrl}/api/v1/ship/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ shipId, secret: secretOf(secret), location: { kind: 'DEVICE' }, harness: 'claude-code' }),
  });
  const { crewToken } = z.object({ crewToken: z.string() }).parse(await registered.json());
  return {
    shipId,
    schedule: async (body: Record<string, unknown>) => {
      const response = await fetch(`${serverUrl}/api/v1/ship/schedule`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${crewToken}` },
        body: JSON.stringify({ model: 'claude-opus-5-5', idempotencyKey: newKey(), ...body }),
      });
      expect(response.status).toBe(200);
      return z.object({ scheduleId: z.string() }).parse(await response.json());
    },
  };
}

async function signedInPage(): Promise<Page> {
  const context = await browser.newContext({ baseURL: web.url });
  contexts.push(context);
  const page = await context.newPage();
  await signIn(page, OPERATOR);
  await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
  return page;
}

describe('a ship’s schedules on its page', () => {
  it('lists a schedule the ship made, and argo pauses it and then cancels it, each shown in its row and its timeline', async () => {
    await crewedOverRest({ name: 'chief-of-staff', type: 'chief' });
    const scheduler = await crewedOverRest({ name: 'scheduler', type: 'scheduler' });
    const { scheduleId } = await scheduler.schedule({
      selector: { kind: 'ship', name: 'chief-of-staff' },
      payload: 'Check in',
      timing: { kind: 'every', every: 'PT6H' },
    });

    const page = await signedInPage();
    await page.goto(`/ships/${scheduler.shipId}`);
    await page.getByRole('tab', { name: 'Schedules' }).click();
    await page.waitForURL(`${web.url}/ships/${scheduler.shipId}?tab=schedules`);
    const row = page.locator(`[data-testid="ship-schedule"][data-schedule-id="${scheduleId}"]`);
    await row.getByText('To chief-of-staff').waitFor();
    await row.getByText('Every 6 h').waitFor();
    await row.getByText('Active', { exact: true }).waitFor();

    await row.getByTestId('ship-schedule-pause').click();
    await page.getByText('Schedule paused').waitFor();
    await row.getByText('Paused', { exact: true }).waitFor();
    expect(await row.getByTestId('ship-schedule-pause').count()).toBe(0);

    await row.getByTestId('ship-schedule-cancel').click();
    await page.getByTestId('cancel-schedule-confirm').click();
    await page.getByText('Schedule cancelled').waitFor();
    await row.getByText('Cancelled', { exact: true }).waitFor();
    expect(await row.getByTestId('ship-schedule-cancel').count()).toBe(0);

    await page.getByRole('tab', { name: 'Timeline' }).click();
    await page.getByText('A scheduled message was paused by argo').waitFor();
    await page.getByText('A scheduled message was cancelled by argo').waitFor();
  });
});
