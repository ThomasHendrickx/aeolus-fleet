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
import { FLEET_URL, OPERATOR, operatorCaller, secretOf } from '../packages/server/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../packages/server/test/support/database.js';
import { newKey } from '../packages/server/test/support/keys.js';
import { createTestClock } from '../packages/server/test/support/postgres-core.js';
import { unwrap } from '../packages/server/test/support/result.js';
import { createSquadronsApp, type SquadronsApp } from '../packages/squadrons/src/app.js';
import { createSquadronsDatabase } from '../packages/squadrons/test/support/database.js';
import { seedRepository } from '../packages/squadrons/test/support/repositories.js';
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
/** The first test's member session, kept so the last test can stand it down. */
let memberCall: Awaited<ReturnType<typeof crewed>> | undefined;
/** The squadron the add-member test grew to two testers, kept so the next test can remove one. */
let grownSquadronId = '';

async function inOrigin(origin: string, ...args: string[]): Promise<void> {
  await run('git', ['-C', origin, ...args], {
    env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 't@example.com' },
  });
}

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), 'aeolus-squadrons-console-'));
  const origin = join(work, 'templates');
  mkdirSync(join(origin, '.aeolus', 'squadrons', 'templates'), { recursive: true });
  mkdirSync(join(origin, '.aeolus', 'squadrons', 'blueprints'), { recursive: true });
  await inOrigin(origin, 'init', '--quiet', '--initial-branch=main');
  writeFileSync(join(origin, '.aeolus/squadrons/templates/tester.yaml'), 'description: Tests.\ncheckIn: 30m\nlaunchNote: Start in the repository root.\ncharter: You test.\nhandoffs:\n  on-pass: The run that passed\n');
  writeFileSync(join(origin, '.aeolus/squadrons/blueprints/team.yaml'), `description: One tester.\nroles:\n  tester:\n    template: ${REPO}#tester@1\nhandoffs:\n  tester.on-pass: flagship\n`);
  await inOrigin(origin, 'add', '.');
  await inOrigin(origin, 'commit', '--quiet', '-m', 'team');
  await inOrigin(origin, 'tag', 'tester@1');
  await inOrigin(origin, 'tag', 'team@1');

  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  useCases = createUseCases({ prisma: database, clock });
  argo = operatorCaller(unwrap(await useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR })));
  const management = unwrap(
    await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'squadrons', type: 'squadrons', fleetScopes: ['fleet:read', 'fleet:manage'] }),
  );

  const webUrl = await reserveWebUrl();
  server = createApp({ databaseUrl, publicUrl: FLEET_URL, consoleOrigin: webUrl, clock, logger: false, receiveWaitMs: 500 });
  serverUrl = await server.listen({ host: '127.0.0.1', port: 0 });
  const squadronsDatabaseUrl = await createSquadronsDatabase();
  await seedRepository(squadronsDatabaseUrl, { fleetId: argo.fleetId, name: REPO, url: `file://${origin}` });
  squadrons = createSquadronsApp({
    databaseUrl: squadronsDatabaseUrl,
    fleetUrl: serverUrl,
    cacheDir: join(work, 'cache'),
    clock,
    logger: false,
  });
  unwrap(await squadrons.connect({ operatorFleetId: argo.fleetId, shipId: management.shipId, secret: secretOf(management.secret) }));
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
    body: JSON.stringify({ shipId, secret, location: { kind: 'DEVICE' }, harness: 'claude-code' }),
  });
  const { crewToken } = z.object({ crewToken: z.string() }).parse(await registered.json());
  return async (operation: 'send' | 'receive' | 'ack', body: Record<string, unknown>): Promise<unknown> => {
    const response = await fetch(`${serverUrl}/api/v1/ship/${operation}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${crewToken}` },
      body: JSON.stringify(operation === 'send' ? { model: 'claude-opus-5-5', ...body } : body),
    });
    return response.json();
  };
}

/** A member session checks in, takes its role and reports on station, as the plugin skill says. */
async function bringOnStation({ call, squadronId }: { call: Awaited<ReturnType<typeof crewed>>; squadronId: string }): Promise<void> {
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
    const crewLine = (await page.getByTestId('member-crew-line-claude-code').textContent()) ?? '';
    expect(crewLine).toMatch(/^\/aeolus:crew \S+ shp_\S+ aeolus_sk_v1_\S+ team-[a-z0-9]{6}$/);
    const squadronId = crewLine.split(' ')[4] ?? '';

    const call = await crewed(crewLine);
    memberCall = call;
    await bringOnStation({ call, squadronId });

    await page.getByTestId('member-row').locator('[data-slot="health-indicator"]').getByText('On time').waitFor({ timeout: LIVE_TIMEOUT_MS });
    await page.getByTestId('squadron-header').getByText('Sailing').waitFor({ timeout: LIVE_TIMEOUT_MS });
    await expect(page.getByTestId('member-crew-line-claude-code').count()).resolves.toBe(0);
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

  it('offers a flagship only Open squadron, and a member Remove from squadron instead of Retire and Rename', async () => {
    const page = await squadronsPage();
    await page.getByTestId('nav-overview').click();
    const rows = page.locator('[data-testid^="fleet-row-"]');
    const flagship = rows.filter({ has: page.getByTestId('fleet-flagship') }).first();
    const member = rows.filter({ has: page.locator('[data-slot="squadron-tag"]') }).first();

    await flagship.getByTestId('fleet-actions').click();
    await page.getByTestId('fleet-ship-open-squadron').waitFor({ timeout: LIVE_TIMEOUT_MS });
    for (const action of ['fleet-ship-retire', 'fleet-ship-rename', 'fleet-ship-release', 'fleet-ship-recrew', 'fleet-ship-ping']) {
      await expect(page.getByTestId(action).count()).resolves.toBe(0);
    }
    await page.keyboard.press('Escape');

    await member.getByTestId('fleet-actions').click();
    await page.getByTestId('fleet-ship-remove').waitFor({ timeout: LIVE_TIMEOUT_MS });
    for (const action of ['fleet-ship-retire', 'fleet-ship-rename', 'fleet-ship-recrew', 'fleet-ship-prompt']) {
      await expect(page.getByTestId(action).count()).resolves.toBe(0);
    }
  });

  it('shows who hands off to whom on the squadron page, read from its blueprint', async () => {
    const page = await squadronsPage();
    await page.getByTestId('squadrons-row').first().getByRole('link', { name: /team/ }).first().click();

    await page.getByTestId('handoff-wiring').getByText('from blueprint team v1').waitFor({ timeout: LIVE_TIMEOUT_MS });
    await expect(page.getByTestId('handoff-row').textContent()).resolves.toBe('testeron-passflagship');
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
    await expect(page.getByTestId('blueprint-source').textContent()).resolves.toMatch(/^\.aeolus\/squadrons\/blueprints\/team\.yaml at [0-9a-f]{7}, /);
    await expect(page.getByTestId('blueprint-role').first().textContent()).resolves.toMatch(/^testertester@11every 30 minStart in the repository root\.$/);
    await page.getByRole('heading', { name: 'Squadrons from this blueprint' }).waitFor();
    await page.getByTestId('blueprint-form').click();
    await page.getByTestId('form-squadron-preview').click();
    await expect(page.getByRole('heading', { name: 'Form a squadron from team v1' }).count()).resolves.toBe(1);
  });

  it('lists the blueprints and templates in git on their tabs, and opens a template read only with its file, charter and hand-offs', async () => {
    const page = await squadronsPage();
    await page.getByTestId('squadrons-tab-blueprints').click();
    await expect(page.getByTestId('blueprint-row').first().textContent()).resolves.toMatch(/^teamv1testerNone|^teamv1tester\d/);
    await page.getByTestId('squadrons-tab-templates').click();
    await page.waitForURL(/\/squadrons\?tab=templates$/);
    await expect(page.getByTestId('template-row').first().textContent()).resolves.toMatch(/^testerv1every 30 minteam/);

    await page.getByTestId('template-row').first().getByRole('link', { name: 'tester' }).click();

    await page.getByTestId('template-view').waitFor();
    await expect(page.getByTestId('template-source').textContent()).resolves.toMatch(/^\.aeolus\/squadrons\/templates\/tester\.yaml at [0-9a-f]{7}, /);
    await expect(page.getByTestId('template-charter-text').textContent()).resolves.toBe('You test.');
    await expect(page.getByTestId('template-check-in').textContent()).resolves.toBe('Every 30 min');
    await expect(page.getByTestId('template-handoff').textContent()).resolves.toBe('on-passThe run that passed');
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

  it('finds the squadron in the command palette and opens it; Form squadron opens the dialog', async () => {
    const page = await squadronsPage();

    await page.keyboard.press('Control+k');
    await page.getByTestId('command-palette-input').fill('team-');
    await page.locator('[data-testid="command-palette-item"][data-item-kind="squadron"]').first().click();
    await page.getByTestId('squadron-header').waitFor();

    await page.keyboard.press('Control+k');
    await page.getByTestId('command-palette-input').fill('form squadron');
    await page.getByTestId('command-palette-item').first().click();
    await page.getByTestId('form-squadron-dialog').waitFor();
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

  it('stands the squadron down: the member stands down, retires, and the squadron is disbanded', async () => {
    const page = await squadronsPage();
    await page.getByTestId('squadrons-row').first().getByRole('link', { name: /team/ }).first().click();
    await page.getByTestId('squadron-stand-down').click();
    await page.getByTestId('stand-down-dialog').waitFor();
    await page.getByTestId('stand-down-confirm').click();
    await page.getByTestId('squadron-header').getByText('Standing down').waitFor({ timeout: LIVE_TIMEOUT_MS });

    let standDown: { deliveryId: string; messageId: string } | undefined;
    await expect
      .poll(
        async () => {
          const { deliveries } = z
            .object({ deliveries: z.array(z.object({ deliveryId: z.string(), messageId: z.string(), contentType: z.string() })) })
            .parse(await memberCall?.('receive', {}));
          standDown = deliveries.find((delivery) => delivery.contentType === 'application/vnd.aeolus.squadron.stand-down+json') ?? standDown;
          return standDown !== undefined;
        },
        { timeout: LIVE_TIMEOUT_MS },
      )
      .toBe(true);
    await memberCall?.('ack', { deliveryId: standDown?.deliveryId });
    const squadronId = (await page.getByTestId('squadron-header').getByRole('heading').textContent()) ?? '';
    await memberCall?.('send', {
      selector: { kind: 'ship', name: squadronId },
      contentType: 'application/vnd.aeolus.squadron.stood-down+json',
      payload: JSON.stringify({ squadron: squadronId }),
      inReplyTo: standDown?.messageId,
      idempotencyKey: 'stood-down',
    });

    await page.getByTestId('squadron-header').getByText('Disbanded').waitFor({ timeout: LIVE_TIMEOUT_MS });
  });

  it('forces the stand down of a forming squadron: with no open work a normal confirm, and it is disbanded at once', async () => {
    const page = await squadronsPage();
    await page.getByTestId('squadrons-form').click();
    await page.getByTestId('form-squadron-preview').click();
    await page.getByTestId('form-squadron-submit').click();
    await page.getByTestId('squadron-header').getByText('Forming').waitFor({ timeout: LIVE_TIMEOUT_MS });

    await page.getByTestId('squadron-force-stand-down').click();
    await page.getByTestId('force-stand-down-dialog').waitFor();
    await page.getByTestId('force-stand-down-confirm').click();

    await page.getByTestId('squadron-header').getByText('Disbanded').waitFor({ timeout: LIVE_TIMEOUT_MS });
  });

  it('adds a member to a sailing squadron and shows its crew line and launch note once', async () => {
    const page = await squadronsPage();
    await page.getByTestId('squadrons-form').click();
    await page.getByTestId('form-squadron-preview').click();
    await page.getByTestId('form-squadron-submit').click();
    const crewLine = (await page.getByTestId('member-crew-line-claude-code').textContent()) ?? '';
    const squadronId = crewLine.split(' ')[4] ?? '';
    grownSquadronId = squadronId;
    await bringOnStation({ call: await crewed(crewLine), squadronId });
    await page.getByTestId('squadron-header').getByText('Sailing').waitFor({ timeout: LIVE_TIMEOUT_MS });

    await page.getByTestId('squadron-add-member').click();
    await page.getByTestId('add-member-dialog').getByText('Blueprint team v1 has 1 tester; the squadron then has 2.').waitFor();
    await page.getByTestId('add-member-submit').click();

    await page.getByTestId('crew-line-dialog').getByRole('heading', { name: /^Crew line for tester-[a-z0-9]{4}$/ }).waitFor({ timeout: LIVE_TIMEOUT_MS });
    await expect(page.getByTestId('crew-line-launch-note').textContent()).resolves.toBe('Start in the repository root.');
    await expect(page.getByTestId('crew-line-text-claude-code').textContent()).resolves.toMatch(new RegExp(`^/aeolus:crew \\S+ shp_\\S+ aeolus_sk_v1_\\S+ ${squadronId}$`));
    await page.getByTestId('crew-line-done').click();
    await page.getByTestId('member-row').nth(1).locator('[data-slot="health-indicator"]').getByText('Not on station').waitFor({ timeout: LIVE_TIMEOUT_MS });
  });

  it('gives a member a new crew line at once, saying its unclaimed one stops working, and shows the new one once', async () => {
    const page = await squadronsPage();
    await page.goto(`/squadrons/${grownSquadronId}`);
    const added = page.getByTestId('member-row').filter({ hasText: 'Not on station' });

    await added.getByTestId('member-new-crew-line').click();
    await expect(page.getByTestId('crew-line-replaced').textContent()).resolves.toBe('The crew line issued earlier, not claimed yet, stops working.');

    await expect(page.getByTestId('crew-line-text-claude-code').textContent()).resolves.toMatch(new RegExp(`^/aeolus:crew \\S+ shp_\\S+ aeolus_sk_v1_\\S+ ${grownSquadronId}$`));
    await expect(page.getByTestId('crew-line-launch-note').textContent()).resolves.toBe('Start in the repository root.');
    await page.getByTestId('crew-line-done').click();
    await expect(page.getByTestId('crew-line-text-claude-code').count()).resolves.toBe(0);
  });

  it('removes a member with a clean inbox after one normal confirm: its ship retires and the squadron keeps sailing', async () => {
    const page = await squadronsPage();
    await page.goto(`${web.url}/squadrons/${grownSquadronId}`);
    await expect.poll(() => page.getByTestId('member-row').count(), { timeout: LIVE_TIMEOUT_MS }).toBe(2);
    const added = page.getByTestId('member-row').filter({ hasText: 'Not on station' });
    const name = (await added.locator('span.font-medium').first().textContent()) ?? '';

    await added.getByTestId('member-remove').click();
    await page.getByTestId('remove-member-dialog').getByText('Its inbox is empty, so no deliveries are affected.').waitFor({ timeout: LIVE_TIMEOUT_MS });
    await page.getByTestId('remove-member-confirm').click();

    const removed = page.getByTestId('member-row').filter({ hasText: name });
    await removed.getByText('Retired').waitFor({ timeout: LIVE_TIMEOUT_MS });
    await expect(removed.getByTestId('member-remove').count()).resolves.toBe(0);
    await page.getByTestId('squadron-header').getByText('Sailing').waitFor();
  });

  it("adds squadrons' own part to the web app's /health and /version", async () => {
    await expect(fetch(`${web.url}/health`).then((response) => response.json())).resolves.toEqual({
      web: 'up',
      server: 'up',
      database: 'up',
      squadrons: { status: 'up', connection: 'connected' },
    });
    const version = z
      .object({ squadrons: z.object({ squadrons: z.string(), migration: z.string().nullable(), connection: z.string() }) })
      .parse(await fetch(`${web.url}/version`).then((response) => response.json()));
    expect(version.squadrons.connection).toBe('connected');
    expect(version.squadrons.migration).toMatch(/^\d{14}_/);
  });
});
