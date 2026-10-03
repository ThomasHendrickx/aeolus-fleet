import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { FastifyInstance } from 'fastify';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createPrismaClient, type PrismaClient } from '../packages/server/src/adapters/prisma/client.js';
import { createApp } from '../packages/server/src/app.js';
import type { Caller } from '../packages/server/src/core/shared/caller.js';
import { createUseCases, type UseCases } from '../packages/server/src/wiring.js';
import { FLEET_URL, OPERATOR, operatorCaller, secretIn } from '../packages/server/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../packages/server/test/support/database.js';
import { newKey } from '../packages/server/test/support/keys.js';
import { createTestClock } from '../packages/server/test/support/postgres-core.js';
import { unwrap } from '../packages/server/test/support/result.js';
import { createSquadronsApp, type SquadronsApp } from '../packages/squadrons/src/app.js';
import { createSquadronsDatabase } from '../packages/squadrons/test/support/database.js';
import { signIn } from './support/console.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';

// The first squadron, end to end in the console: the operator forms it from a
// blueprint in git, the squadron's page shows each member's crew line and
// launch note once, and a member that checks in shows on station; the
// squadron sails once every member is.

const run = promisify(execFile);
const REPO = 'example.com/templates';
const CHECK_IN = 'application/vnd.aeolus.squadron.check-in+json';
const ROLE = 'application/vnd.aeolus.squadron.role+json';
const ON_STATION = 'application/vnd.aeolus.squadron.on-station+json';
const clock = createTestClock('2026-10-03T12:00:00.000Z');
/** Sign-ins are rate limited per window; each test signs in after the window of the one before. */
const SIGN_IN_WINDOW_MS = 60_000;
/** The squadron page asks again every few seconds; a check-in shows within that. */
const LIVE_TIMEOUT_MS = 20_000;

let work: string;
let database: PrismaClient;
let useCases: UseCases;
let argo: Caller;
let server: FastifyInstance;
let serverUrl: string;
let squadrons: SquadronsApp;
let web: RunningWeb;
let browser: Browser;
const contexts: BrowserContext[] = [];

async function inOrigin(origin: string, ...args: string[]): Promise<void> {
  await run('git', ['-C', origin, ...args], {
    env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 't@example.com' },
  });
}

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), 'aeolus-squadrons-console-'));
  const origin = join(work, 'templates');
  mkdirSync(join(origin, 'squadrons', 'templates'), { recursive: true });
  mkdirSync(join(origin, 'squadrons', 'blueprints'), { recursive: true });
  await inOrigin(origin, 'init', '--quiet', '--initial-branch=main');
  writeFileSync(join(origin, 'squadrons/templates/tester.yaml'), 'description: Tests.\ncheckIn: 30m\nlaunchNote: Start in the repository root.\ncharter: You test.\n');
  writeFileSync(join(origin, 'squadrons/blueprints/team.yaml'), `description: One tester.\nroles:\n  tester:\n    template: ${REPO}#tester@1\n`);
  await inOrigin(origin, 'add', '.');
  await inOrigin(origin, 'commit', '--quiet', '-m', 'team');
  await inOrigin(origin, 'tag', 'tester@1');
  await inOrigin(origin, 'tag', 'team@1');

  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  useCases = createUseCases({ prisma: database, clock, fleetUrl: FLEET_URL });
  argo = operatorCaller(unwrap(await useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR })));
  const management = unwrap(
    await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'squadrons', type: 'squadrons', fleetScopes: ['fleet:read', 'fleet:manage'] }),
  );

  const webUrl = await reserveWebUrl();
  server = createApp({ databaseUrl, publicUrl: FLEET_URL, consoleOrigin: webUrl, clock, logger: false, receiveWaitMs: 500 });
  serverUrl = await server.listen({ host: '127.0.0.1', port: 0 });
  squadrons = createSquadronsApp({
    databaseUrl: await createSquadronsDatabase(),
    fleetUrl: serverUrl,
    repositories: [{ url: `file://${origin}`, name: REPO, path: undefined, token: undefined }],
    cacheDir: join(work, 'cache'),
    clock,
    logger: false,
  });
  unwrap(await squadrons.connect({ operatorFleetId: argo.fleetId, shipId: management.shipId, secret: secretIn(management.prompt) }));
  await squadrons.refreshCatalogue();
  squadrons.startFlagships(200);
  const squadronsUrl = await squadrons.server.listen({ host: '127.0.0.1', port: 0 });
  web = await startWeb({ url: webUrl, serverUrl, squadronsUrl });
  browser = await launchChromium();
});

afterAll(async () => {
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
  await web.stop();
  await squadrons.close();
  await server.close();
  await database.$disconnect();
  rmSync(work, { recursive: true, force: true });
});

async function squadronsPage(): Promise<Page> {
  clock.advance(SIGN_IN_WINDOW_MS);
  const context = await browser.newContext({ baseURL: web.url });
  contexts.push(context);
  const page = await context.newPage();
  await signIn(page, OPERATOR);
  await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
  await page.getByTestId('nav-squadrons').click();
  await page.getByRole('heading', { name: 'Squadrons' }).first().waitFor();
  return page;
}

/** A member's session over the fleet's REST API, crewed with its crew line. */
async function crewed(crewLine: string) {
  const [, , shipId = '', secret = ''] = crewLine.split(' ');
  const registered = await fetch(`${serverUrl}/api/v1/ship/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ shipId, secret, location: { kind: 'DEVICE' } }),
  });
  const { crewToken } = z.object({ crewToken: z.string() }).parse(await registered.json());
  return async (operation: 'send' | 'receive' | 'ack', body: Record<string, unknown>): Promise<unknown> => {
    const response = await fetch(`${serverUrl}/api/v1/ship/${operation}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${crewToken}` },
      body: JSON.stringify(body),
    });
    return response.json();
  };
}

describe('the first squadron in the console', () => {
  it('forms from a blueprint, shows the crew line and launch note once, and sails once its member checks in', async () => {
    const page = await squadronsPage();
    await page.getByTestId('squadrons-form-first').click();
    await page.getByTestId('form-squadron-preview').click();
    await page.getByTestId('form-squadron-submit').click();

    await page.getByTestId('squadron-header').waitFor();
    await expect(page.getByTestId('station-progress').textContent()).resolves.toBe('0 of 1 on station');
    await page.getByText('Start in the repository root.').waitFor();
    const crewLine = (await page.getByTestId('member-crew-line').textContent()) ?? '';
    expect(crewLine).toMatch(/^\/aeolus:crew \S+ shp_\S+ aeolus_sk_v1_\S+ team-[a-z0-9]{6}$/);
    const squadronId = crewLine.split(' ')[4] ?? '';

    const call = await crewed(crewLine);
    await call('send', { selector: { kind: 'ship', name: squadronId }, contentType: CHECK_IN, payload: JSON.stringify({ squadron: squadronId }), idempotencyKey: 'check-in' });
    let role: { deliveryId: string; messageId: string } | undefined;
    await expect
      .poll(
        async () => {
          const { deliveries } = z
            .object({ deliveries: z.array(z.object({ deliveryId: z.string(), messageId: z.string(), contentType: z.string() })) })
            .parse(await call('receive', {}));
          role = deliveries.find((delivery) => delivery.contentType === ROLE) ?? role;
          return role !== undefined;
        },
        { timeout: LIVE_TIMEOUT_MS },
      )
      .toBe(true);
    await call('ack', { deliveryId: role?.deliveryId });
    await call('send', {
      selector: { kind: 'ship', name: squadronId },
      contentType: ON_STATION,
      payload: JSON.stringify({ squadron: squadronId, role: 'tester' }),
      inReplyTo: role?.messageId,
      idempotencyKey: 'on-station',
    });

    await page.getByTestId('member-row').locator('[data-slot="health-indicator"]').getByText('On time').waitFor({ timeout: LIVE_TIMEOUT_MS });
    await page.getByTestId('squadron-header').getByText('Sailing').waitFor({ timeout: LIVE_TIMEOUT_MS });
    await expect(page.getByTestId('member-crew-line').count()).resolves.toBe(0);
    // From the fleet: where the member's session runs, and its open deliveries.
    await page.getByTestId('member-row').getByText('Device').first().waitFor({ timeout: LIVE_TIMEOUT_MS });
    await expect(page.getByTestId('member-inbox').textContent()).resolves.toMatch(/^\d+ open$/);
  });

  it('lists the squadron with its blueprint version and state', async () => {
    const page = await squadronsPage();

    await page.getByTestId('squadrons-row').first().waitFor();
    await expect(page.getByTestId('squadrons-row').first().textContent()).resolves.toMatch(/team-[a-z0-9]{6}team v1Sailing1 member/);
  });

  it('marks the flagship and tags the member with its squadron on the fleet overview', async () => {
    const page = await squadronsPage();
    await page.getByTestId('nav-overview').click();

    await page.getByTestId('fleet-flagship').first().waitFor({ timeout: LIVE_TIMEOUT_MS });
    const tag = page.locator('[data-slot="squadron-tag"]').first();
    await tag.waitFor();
    await expect(tag.textContent()).resolves.toMatch(/^team-[a-z0-9]{6}· tester$/);
    await expect(tag.getAttribute('href')).resolves.toMatch(/^\/squadrons\/team-[a-z0-9]{6}$/);
  });

  it('shows a message the flagship kept, and opens it whole on the flagship page', async () => {
    const flagship = await database.ship.findFirstOrThrow({ where: { type: 'flagship' } });
    unwrap(
      await useCases.sendMessage(argo, {
        selector: { kind: 'ship', name: flagship.name },
        payload: 'Build login for issue #42',
        contentType: 'text/plain',
        idempotencyKey: newKey(),
      }),
    );
    const page = await squadronsPage();
    await page.getByRole('link', { name: flagship.name }).first().click();

    const kept = page.getByTestId('kept-message').first();
    await kept.waitFor({ timeout: LIVE_TIMEOUT_MS });
    await expect(kept.textContent()).resolves.toContain('Build login for issue #42');
    await kept.getByRole('link').click();
    await page.waitForURL(new RegExp(`/ships/${flagship.id}\\?tab=messages&message=msg_`));
  });

  it("opens the squadron's blueprint, with its role and the squadron formed from it, and forms from that version", async () => {
    const page = await squadronsPage();
    await page.getByTestId('squadrons-row').first().getByRole('link', { name: /team/ }).first().click();
    await page.getByTestId('squadron-blueprint').click();

    await page.getByTestId('blueprint-view').waitFor();
    await expect(page.getByTestId('blueprint-role').first().textContent()).resolves.toMatch(/^testertester@11every 30 minStart in the repository root\.$/);
    await page.getByRole('heading', { name: 'Squadrons from this blueprint' }).waitFor();
    await page.getByTestId('blueprint-form').click();
    await page.getByTestId('form-squadron-preview').click();
    await expect(page.getByRole('heading', { name: 'Form a squadron from team v1' }).count()).resolves.toBe(1);
  });

  it("filters the fleet overview to one squadron: its flagship and members only", async () => {
    const flagship = await database.ship.findFirstOrThrow({ where: { type: 'flagship' } });
    const page = await squadronsPage();
    await page.getByTestId('nav-overview').click();

    await page.getByTestId('fleet-filter-squadron').click();
    await page.getByRole('option', { name: flagship.name }).click();

    await expect.poll(() => page.locator('[data-testid^="fleet-row-"]').count()).toBe(2);
    await page.getByTestId(`fleet-row-${flagship.name}`).waitFor();
    expect(page.url()).toContain(`squadron=${flagship.name}`);
  });

  it('searches and filters the Squadrons list, keeping the view in the URL', async () => {
    const page = await squadronsPage();
    await page.getByTestId('squadrons-row').first().waitFor();

    await page.getByTestId('squadrons-search').fill('no-such-squadron');
    await page.getByText('No squadrons match').waitFor();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await page.getByTestId('squadrons-row').first().waitFor();

    await page.getByTestId('squadrons-filter-state').click();
    await page.getByRole('option', { name: 'Forming' }).click();
    await page.getByText('No squadrons match').waitFor();
    expect(page.url()).toContain('state=forming');
  });

  // Last: it moves the clock past three check-in intervals.
  it('sends a member silent for three check-in intervals to Needs attention, and counts it', async () => {
    const THREE_INTERVALS_AND_MORE_MS = 2 * 60 * 60 * 1000;
    clock.advance(THREE_INTERVALS_AND_MORE_MS);
    const page = await squadronsPage();
    await page.getByTestId('squadrons-row').first().getByRole('link', { name: /team/ }).first().click();
    await page.getByTestId('member-row').locator('[data-slot="health-indicator"]').getByText('Silent').waitFor({ timeout: LIVE_TIMEOUT_MS });

    await page.getByTestId('nav-attention').click();

    await page.getByRole('heading', { name: 'Silent members (1)' }).waitFor({ timeout: LIVE_TIMEOUT_MS });
    await expect(page.getByTestId('silent-member').textContent()).resolves.toMatch(/tester-[a-z0-9]{4}team-[a-z0-9]{6}· tester/);
    await expect(page.getByTestId('nav-attention-count').textContent()).resolves.toMatch(/^1/);
  });
});

