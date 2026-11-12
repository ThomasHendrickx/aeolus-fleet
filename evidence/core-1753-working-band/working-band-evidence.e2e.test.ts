import type { FleetId } from '@aeolus-fleet/common';
import { SCOPES } from '@aeolus-fleet/common';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { FastifyInstance } from 'fastify';
import { mkdir, writeFile } from 'node:fs/promises';
import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../packages/core/src/adapters/prisma/client.js';
import { createApp } from '../packages/core/src/app.js';
import type { ShipCaller } from '../packages/core/src/domain/shared/caller.js';
import type { AppRouter } from '../packages/core/src/index.js';
import { createUseCases } from '../packages/core/src/wiring.js';
import { FLEET_URL, secretOf } from '../packages/core/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../packages/core/src/testing/database.js';
import { newKey } from '../packages/core/src/testing/keys.js';
import { unwrap } from '../packages/core/src/testing/result.js';
import { launchChromium, reserveWebUrl, startWeb, type RunningWeb } from './support/web.js';

// Evidence only for core #1753, never committed to the feature branch: the console's
// whole fleet overview, the real React Harbour on a real server, captured and probed.

const OUT = process.env.EVIDENCE_DIR ?? '/tmp/b1753/evidence';
const INSTALLATION_TOKEN = 'aeolus_installation_test_0123456789abcdef';

let database: PrismaClient;
let server: FastifyInstance;
let serverUrl: string;
let web: RunningWeb;
let browser: Browser;
let fleetId: FleetId;
let core: ReturnType<typeof createUseCases>;
let argo: ShipCaller;
type Crew = Awaited<ReturnType<ReturnType<typeof createUseCases>['authenticate']['byCrewToken']>>;
const crews = new Map<string, Crew>();
const checks: Record<string, unknown>[] = [];

function installation() {
  return createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${serverUrl}/trpc`, headers: { 'x-aeolus-installation-token': INSTALLATION_TOKEN } })] }).installation;
}

async function crewed(name: string, state: 'working' | 'blocked' | 'idle', note: string) {
  const ship = unwrap(await core.commissionShip(argo, { idempotencyKey: newKey(), name, type: 'builder' }));
  const { crewToken } = unwrap(await core.claimShip({ shipId: ship.shipId, secret: secretOf(ship.secret), location: { kind: 'DEVICE' }, harness: 'claude-code' }));
  const crew = await core.authenticate.byCrewToken(crewToken);
  crews.set(name, crew);
  unwrap(await core.report(unwrap(crew), { state, note }));
  return ship.shipId;
}

beforeAll(async () => {
  await mkdir(OUT, { recursive: true });
  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  const webUrl = await reserveWebUrl();
  server = createApp({ databaseUrl, publicUrl: FLEET_URL, consoleOrigin: webUrl, logger: false, installationToken: INSTALLATION_TOKEN });
  serverUrl = await server.listen({ host: '127.0.0.1', port: 0 });
  web = await startWeb({ url: webUrl, serverUrl });
  browser = await launchChromium();
  const created = await installation().fleets.create.mutate({ requestId: newKey(), name: 'working-band', operatorEmail: 'band@example.com' });
  fleetId = created.fleetId;
  argo = { fleetId, shipId: created.operatorShipId, kind: 'operator', scopes: [...SCOPES] };
  core = createUseCases({ prisma: database });
  for (const [name, note] of [
    ['orchestrator', 'Cutting #189 into slices'],
    ['design-1', 'Drawing the Fleet page'],
    ['build-1', 'Building the working band'],
    ['review-1', 'Reviewing #1746'],
    ['research-1', 'Reading the motion catalogue'],
    ['walk-1', 'Walking the candidate'],
  ] as const) {
    await crewed(name, 'working', note);
  }
  await crewed('planner', 'blocked', 'Blocked: waiting for release 0.39.0');
  await crewed('helper', 'idle', 'Nothing open');
  unwrap(await core.commissionShip(argo, { idempotencyKey: newKey(), name: 'walker-3', type: 'reviewer' }));
  const alerted = unwrap(await core.commissionShip(argo, { idempotencyKey: newKey(), name: 'builder-gateway', type: 'deployer' })).shipId;
  unwrap(
    await core.raiseAlert(argo, {
      shipId: alerted,
      signal: 'delivery-unacknowledged',
      occurrenceKey: 'dlv_01m66p4k2v9qz8f7x3n5c1d1v1',
      since: '2026-11-01T11:45:00.000Z',
      facts: { deliveryId: 'dlv_01m66p4k2v9qz8f7x3n5c1d1v1', messageId: 'msg_01m66p4k2v9qz8f7x3n5c1msg1', state: 'pending', awaitingCrew: true, minutes: 15 },
    }),
  );
}, 240_000);

afterAll(async () => {
  await writeFile(`${OUT}/checks.json`, JSON.stringify(checks, null, 2));
  await browser.close();
  await web.stop();
  await server.close();
  await database.$disconnect();
});

const SIZES = [
  ['phone', 375, 812],
  ['phone', 390, 844],
  ['desktop', 1440, 1000],
  ['desktop', 1920, 1080],
] as const;

async function open(width: number, height: number, theme: 'light' | 'dark', reduced: boolean, video?: string): Promise<Page> {
  const { ticket } = await installation().operators.issueSignInTicket.mutate({ fleetId });
  const context = await browser.newContext({
    baseURL: web.url,
    viewport: { width, height },
    colorScheme: theme,
    reducedMotion: reduced ? 'reduce' : 'no-preference',
    ...(width < 700 ? { isMobile: true, hasTouch: true } : {}),
    ...(video === undefined ? {} : { recordVideo: { dir: video, size: { width, height } } }),
  });
  const page = await context.newPage();
  await page.goto(`/sign-in/ticket?ticket=${encodeURIComponent(ticket)}`);
  await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
  await page.getByTestId('harbour-tile-live').first().waitFor();
  return page;
}

/** What the browser draws for every band and tile on the screen, at this moment. */
function probeScreen(page: Page) {
  return page.evaluate(() => {
    const bands = [...document.querySelectorAll<HTMLElement>('[data-testid=harbour-tile-live]')];
    const tiles = [...document.querySelectorAll<HTMLElement>('[data-testid=harbour-tile]')];
    return {
      isDark: document.documentElement.classList.contains('dark'),
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      tiles: tiles.length,
      workingTiles: tiles.filter((tile) => tile.dataset.state === 'working').length,
      bands: bands.map((band) => {
        const style = getComputedStyle(band);
        const animation = band.getAnimations()[0];
        const timing = animation?.effect?.getComputedTiming();
        return {
          animationName: style.animationName,
          duration: timing?.duration ?? null,
          iterations: timing?.iterations ?? null,
          timingFunction: style.animationTimingFunction,
          staticOpacity: style.opacity,
          backgroundImage: style.backgroundImage.slice(0, 40),
          backgroundColor: style.backgroundColor,
          height: band.getBoundingClientRect().height,
        };
      }),
      arrowsAsBridgeMendsThem: document.querySelectorAll('a[data-testid=harbour-tile] > span.absolute').length,
      linkTransition: getComputedStyle(tiles.find((tile) => tile.tagName === 'A') ?? document.body).transition,
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
}

/** The first band's opacity and offset, sampled every frame for 4.2 s while it runs, and the tile's bounds across those frames. */
function sampleLoop(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ samples: { t: number; opacity: number; offset: number }[]; tileBoundsStable: boolean }>((resolve) => {
        const band = document.querySelector<HTMLElement>('[data-testid=harbour-tile-live]');
        const tile = band?.closest<HTMLElement>('[data-testid=harbour-tile]');
        if (!band || !tile) throw new Error('no band');
        const start = performance.now();
        const first = JSON.stringify(tile.getBoundingClientRect());
        let stable = true;
        const samples: { t: number; opacity: number; offset: number }[] = [];
        const frame = (now: number) => {
          const style = getComputedStyle(band);
          const animation = band.getAnimations()[0];
          samples.push({ t: Math.round(Number(animation?.currentTime ?? 0) % 3800), opacity: Number(style.opacity), offset: new DOMMatrixReadOnly(style.transform).m41 / band.offsetWidth });
          stable &&= JSON.stringify(tile.getBoundingClientRect()) === first;
          if (now - start < 4200) requestAnimationFrame(frame);
          else resolve({ samples, tileBoundsStable: stable });
        };
        requestAnimationFrame(frame);
      }),
  );
}

describe('working band on the console fleet overview (evidence)', () => {
  for (const [device, width, height] of SIZES) {
    for (const theme of ['light', 'dark'] as const) {
      for (const reduced of [false, true]) {
        it(`${device} ${width} ${theme} ${reduced ? 'reduced' : 'motion'}`, async () => {
          const page = await open(width, height, theme, reduced);
          await page.waitForTimeout(600);
          const name = `${device}-${width}-${theme}${reduced ? '-reduced' : ''}`;
          await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
          const probe = await probeScreen(page);
          const loop = reduced ? null : await sampleLoop(page);
          checks.push({ name, ...probe, ...(loop === null ? {} : { loopSamples: loop.samples.length, tileBoundsStableThroughLoop: loop.tileBoundsStable, peakOpacity: Math.max(...loop.samples.map((s) => s.opacity)), invisibleFrom2400: loop.samples.filter((s) => s.t >= 2410 && s.t <= 3790).every((s) => s.opacity === 0), samples: width === 1440 && theme === 'light' ? loop.samples : undefined }) });
          expect(probe.overflowX).toBe(false);
          expect(probe.bands).toHaveLength(probe.workingTiles);
          await page.context().close();
        });
      }
    }
  }

  for (const reduced of [false, true]) {
    it(`state changes live on desktop 1440 light ${reduced ? 'reduced' : 'motion'}`, async () => {
      const page = await open(1440, 1000, 'light', reduced, reduced ? undefined : `${OUT}/video`);
      await page.waitForTimeout(4000);
      // Watch build-1's tile: on each change, the word, the band and the tile's transitions in the same frame.
      await page.evaluate(() => {
        const log: unknown[] = [];
        Object.assign(window, { bandLog: log });
        const start = performance.now();
        new MutationObserver(() => {
          for (const tile of document.querySelectorAll<HTMLElement>('[data-testid=harbour-tile]')) {
            if (!tile.textContent?.includes('build-1')) continue;
            const word = tile.querySelector('[data-testid=ship-state]')?.textContent;
            const last = log.at(-1) as { word?: string } | undefined;
            if (last?.word === word) continue;
            const box = tile.getBoundingClientRect();
            log.push({
              t: Math.round(performance.now() - start),
              word,
              state: tile.dataset.state,
              hasBand: tile.querySelector('[data-testid=harbour-tile-live]') !== null,
              transitions: tile.getAnimations().map((a) => (a instanceof CSSTransition ? `${a.transitionProperty} ${String(a.effect?.getTiming().duration)} ${String(a.effect?.getTiming().easing)}` : a.constructor.name)),
              transform: getComputedStyle(tile).transform,
              box: { x: box.x, y: box.y, width: box.width, height: box.height },
            });
          }
        }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
      });
      const crew = crews.get('build-1');
      if (crew === undefined) throw new Error('no build-1');
      for (const [state, note] of [
        ['blocked', 'Waiting for a review'],
        ['idle', 'Nothing open'],
        ['working', 'Building the working band'],
      ] as const) {
        unwrap(await core.report(unwrap(crew), { state, note }));
        await page.locator(`[data-testid=harbour-tile][data-state=${state}]`).filter({ hasText: 'build-1' }).waitFor();
        await page.waitForTimeout(1500);
        if (!reduced) await page.screenshot({ path: `${OUT}/state-${state}.png`, fullPage: true });
      }
      const log = await page.evaluate(() => (window as unknown as { bandLog: unknown[] }).bandLog);
      checks.push({ name: `state-changes-${reduced ? 'reduced' : 'motion'}`, log });
      await page.context().close();
    });
  }
});
