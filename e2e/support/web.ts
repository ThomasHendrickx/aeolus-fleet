import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

import { chromium, type Browser } from 'playwright';

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
 * Starts the web app with `next dev`, forwarding /trpc to the given server, and
 * waits until the sign-in page answers (the first request compiles it).
 */
export async function startWeb(serverUrl: string): Promise<RunningWeb> {
  const port = await freePort();
  const nextBin = createRequire(`${webRoot}/package.json`).resolve('next/dist/bin/next');
  const child = spawn(process.execPath, [nextBin, 'dev', '--port', String(port)], {
    cwd: webRoot,
    env: { ...process.env, AEOLUS_SERVER_URL: serverUrl, NEXT_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));

  const url = `http://localhost:${String(port)}`;
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
