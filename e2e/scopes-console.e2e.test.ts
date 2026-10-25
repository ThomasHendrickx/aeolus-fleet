import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../packages/core/src/adapters/prisma/client.js';
import { createApp } from '../packages/core/src/app.js';
import type { ShipCaller } from '../packages/core/src/domain/shared/caller.js';
import { createUseCases, type UseCases } from '../packages/core/src/wiring.js';
import { FLEET_URL, OPERATOR, operatorCaller } from '../packages/core/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../packages/core/src/testing/database.js';
import { newKey } from '../packages/core/src/testing/keys.js';
import { createTestClock } from '../packages/core/test/support/postgres-core.js';
import { unwrap } from '../packages/core/src/testing/result.js';
import { signIn } from './support/console.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';
import { withOperatorLogin } from '../packages/core/test/support/operator-login.js';

// The Scopes page in the console (design gateway-scopes, S2), end to end:
// argo defines one of the fleet's own scopes, changes its description, and
// is refused its removal while a ship holds it, each refusal inline.

const clock = createTestClock('2026-10-25T12:00:00.000Z');
/** A change shows within this. */
const WITHIN = { timeout: 20_000 };

let database: PrismaClient;
let useCases: UseCases;
let argo: ShipCaller;
let server: FastifyInstance;
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

async function signedInOnScopes(): Promise<Page> {
  const context = await browser.newContext({ baseURL: web.url, viewport: { width: 1440, height: 900 } });
  contexts.push(context);
  const page = await context.newPage();
  await signIn(page, OPERATOR);
  await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
  // Live shows once the page is hydrated: a click before that does nothing.
  await page.getByRole('banner').getByText('Live', { exact: true }).waitFor(WITHIN);
  await page.getByTestId('overview-scopes').click();
  await page.getByRole('heading', { name: 'Scopes', level: 1 }).waitFor(WITHIN);
  return page;
}

async function submitScope(page: Page, scope: { scope?: string; description: string }): Promise<void> {
  const dialog = page.getByTestId('scope-dialog');
  await dialog.waitFor();
  if (scope.scope !== undefined) {
    await dialog.getByTestId('scope-dialog-scope').fill(scope.scope);
  }
  await dialog.getByTestId('scope-dialog-description').fill(scope.description);
  await dialog.getByTestId('scope-dialog-submit').click();
}

describe('Scopes in the console', () => {
  it("defines a scope of the fleet's own, changes its description, and is refused its removal while a ship holds it", async () => {
    const page = await signedInOnScopes();
    await expect.poll(() => page.getByTestId('scopes-namespace-messages').isVisible(), WITHIN).toBe(true);

    await page.getByTestId('scopes-define').click();
    await submitScope(page, { scope: 'gateway:read', description: 'Read' });
    await expect.poll(() => page.getByTestId('scope-dialog').textContent(), WITHIN).toContain('gateway is reserved for a plugin Aeolus knows: pick another namespace');

    await submitScope(page, { scope: 'crm:read-leads', description: 'Read leads in the CRM' });
    const crm = page.getByTestId('scopes-namespace-crm');
    await expect.poll(() => crm.textContent(), WITHIN).toContain("The fleet's own");
    await expect.poll(() => crm.getByTestId('scopes-row-crm:read-leads').textContent(), WITHIN).toContain('Read leads in the CRM');

    await crm.getByTestId('scopes-row-menu').click();
    await page.getByTestId('scopes-describe').click();
    await submitScope(page, { description: 'Read every lead in the CRM' });
    await expect.poll(() => crm.getByTestId('scopes-description').textContent(), WITHIN).toBe('Read every lead in the CRM');

    unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'lead-scout', type: 'implementer', scopes: ['crm:read-leads'] }));
    await crm.getByTestId('scopes-row-menu').click();
    await page.getByTestId('scopes-remove').click();
    await page.getByTestId('remove-scope-confirm').click();
    await expect.poll(() => page.getByTestId('remove-scope-dialog').textContent(), WITHIN).toContain('1 ship holds crm:read-leads: revoke it from it first');
    await page.reload();
    await expect.poll(() => page.getByTestId('scopes-namespace-crm').isVisible(), WITHIN).toBe(true);
  });
});
