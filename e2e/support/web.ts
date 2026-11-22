import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type Browser } from 'playwright';
import { z } from 'zod';

// .ts, not .js: a test run starts this file in Node itself, beside Vitest.
import { claimFreePort } from './port-claims.ts';

const webRoot = fileURLToPath(new URL('../../packages/console', import.meta.url));

/** A port nothing listens on and no other test run on this host serves on (port-claims.ts). */
export function freePort(): Promise<number> {
  return claimFreePort();
}

/** Runs next start for as long as the process that starts it lives. */
const nextStart = fileURLToPath(new URL('next-start.ts', import.meta.url));

/** The build's route manifest: each internal route name to the path it serves. */
export const routeManifest = z.record(z.string(), z.string());

/**
 * The routes to wait for, from the production build's own manifest
 * (.next/app-path-routes-manifest.json), so a page added to the console is
 * waited for without editing this file. Every page and route handler counts,
 * each dynamic segment filled with a made-up value; api routes are called by
 * the console itself, never opened by a test.
 */
export function routesToWaitFor(manifest: Readonly<Record<string, string>>): string[] {
  return Object.values(manifest)
    .filter((route) => route !== '/api' && !route.startsWith('/api/') && !route.startsWith('/_'))
    .map((route) => route.replace(/\[[^\]]+\]/g, 'test'));
}

export interface RunningWeb {
  url: string;
  stop(): Promise<void>;
}

/**
 * Where the web app will run: a free port on localhost, claimed for this
 * test run (see freePort). Known before the server starts, so the server can
 * take it as the console's origin, the one state-changing console calls must
 * come from.
 */
export async function reserveWebUrl(): Promise<string> {
  return `http://localhost:${String(await freePort())}`;
}

/**
 * Starts the web app with `next start` at the reserved URL, with the given
 * server as its AEOLUS_SERVER_URL (and a fake squadrons as its AEOLUS_SQUADRONS_URL, a fake trierarch plugin as its AEOLUS_TRIERARCH_PLUGIN_URL, the hosting service's sign-in as its
 * AEOLUS_HOSTED_SIGN_IN_URL, and the account app as AEOLUS_ACCOUNT_APP_URL with the console's client credentials, when given), and waits until every route of the build answers (routesToWaitFor). The console must be built first (npm run build:e2e).
 *
 * The browser calls the server itself, so the server goes by `localhost`
 * like the console: one site, or the SameSite=Strict session cookie would
 * stay behind.
 */
export async function startWeb(web: { url: string; serverUrl: string; squadronsUrl?: string; trierarchPluginUrl?: string; hostedSignInUrl?: string; hostedAccountUrl?: string; hostedAnalytics?: Readonly<Record<string, string>>; accountApp?: { url: string; clientId: string; clientSecret: string } }): Promise<RunningWeb> {
  const { url, serverUrl } = web;
  const port = new URL(url).port;
  const sameSiteServer = new URL(serverUrl);
  sameSiteServer.hostname = 'localhost';
  const nextBin = createRequire(`${webRoot}/package.json`).resolve('next/dist/bin/next');
  const child = spawn(process.execPath, [nextStart, nextBin, 'start', '--port', port], {
    cwd: webRoot,
    env: {
      ...process.env,
      AEOLUS_SERVER_URL: sameSiteServer.origin,
      AEOLUS_CONSOLE_URL: url,
      ...(web.squadronsUrl === undefined ? {} : { AEOLUS_SQUADRONS_URL: web.squadronsUrl }),
      ...(web.trierarchPluginUrl === undefined ? {} : { AEOLUS_TRIERARCH_PLUGIN_URL: web.trierarchPluginUrl }),
      ...(web.hostedSignInUrl === undefined ? {} : { AEOLUS_HOSTED_SIGN_IN_URL: web.hostedSignInUrl }),
      ...(web.hostedAccountUrl === undefined ? {} : { AEOLUS_HOSTED_ACCOUNT_URL: web.hostedAccountUrl }),
      ...web.hostedAnalytics,
      ...(web.accountApp === undefined ? {} : { AEOLUS_ACCOUNT_APP_URL: web.accountApp.url, AEOLUS_ACCOUNT_APP_CLIENT_ID: web.accountApp.clientId, AEOLUS_ACCOUNT_APP_CLIENT_SECRET: web.accountApp.clientSecret }),
      NODE_ENV: 'production',
      NEXT_TELEMETRY_DISABLED: '1',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));

  const stop = async () => {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await once(child, 'exit');
    }
  };

  const routes = routesToWaitFor(routeManifest.parse(JSON.parse(await readFile(join(webRoot, '.next', 'app-path-routes-manifest.json'), 'utf8'))));
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`next start exited with ${String(child.exitCode)}:\n${output}`);
    }
    try {
      const responses = await Promise.all(routes.map((route) => fetch(`${url}${route}`, { redirect: 'manual' })));
      if (responses.every((response) => response.status < 500)) {
        return { url, stop };
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await stop();
  throw new Error(`next start did not serve the routes in time:\n${output}`);
}

/**
 * Chromium from Playwright (`npx playwright install chromium`), or the one at
 * CHROMIUM_EXECUTABLE_PATH when a machine already has a matching Chromium.
 */
export function launchChromium(): Promise<Browser> {
  const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH;
  return chromium.launch(executablePath ? { executablePath } : {});
}
