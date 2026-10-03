import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { chromium, type Browser } from 'playwright';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const webRoot = fileURLToPath(new URL('../../packages/web', import.meta.url));

/** A port nothing listens on right now. */
export async function freePort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  probe.close();
  if (address === null || typeof address === 'string') {
    throw new Error('could not find a free port');
  }
  return address.port;
}

export interface RunningWeb {
  url: string;
  stop(): Promise<void>;
}

/**
 * Where the web app will run: a free port on localhost. Known before the
 * server starts, so the server can take it as the console's origin, the one
 * state-changing console calls must come from.
 */
export async function reserveWebUrl(): Promise<string> {
  return `http://localhost:${String(await freePort())}`;
}

/**
 * Starts the web app with `next dev` at the reserved URL, with the given
 * server as its AEOLUS_SERVER_URL (and squadrons as its AEOLUS_SQUADRONS_URL, when given), and waits until the sign-in page answers
 * (the first request compiles it). The console bundles common's built
 * package, as `npm run dev` does, so common is built first.
 *
 * The browser calls the server itself, so the server goes by `localhost`
 * like the console: one site, or the SameSite=Strict session cookie would
 * stay behind.
 */
export async function startWeb(web: { url: string; serverUrl: string; squadronsUrl?: string }): Promise<RunningWeb> {
  const { url, serverUrl } = web;
  await promisify(execFile)('npm', ['run', 'build', '--workspace', '@aeolus-fleet/common'], { cwd: repositoryRoot });
  const port = new URL(url).port;
  const sameSiteServer = new URL(serverUrl);
  sameSiteServer.hostname = 'localhost';
  const nextBin = createRequire(`${webRoot}/package.json`).resolve('next/dist/bin/next');
  const child = spawn(process.execPath, [nextBin, 'dev', '--port', port], {
    cwd: webRoot,
    env: {
      ...process.env,
      AEOLUS_SERVER_URL: sameSiteServer.origin,
      ...(web.squadronsUrl === undefined ? {} : { AEOLUS_SQUADRONS_URL: web.squadronsUrl }),
      NEXT_TELEMETRY_DISABLED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
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

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`next dev exited with ${String(child.exitCode)}:\n${output}`);
    }
    try {
      if ((await fetch(`${url}/sign-in`)).ok) {
        return { url, stop };
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await stop();
  throw new Error(`next dev did not serve /sign-in in time:\n${output}`);
}

/**
 * Chromium from Playwright (`npx playwright install chromium`), or the one at
 * CHROMIUM_EXECUTABLE_PATH when a machine already has a matching Chromium.
 */
export function launchChromium(): Promise<Browser> {
  const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH;
  return chromium.launch(executablePath ? { executablePath } : {});
}
