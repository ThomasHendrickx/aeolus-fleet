import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';

import { afterAll, describe, expect, it } from 'vitest';

import { reserveWebUrl, startWeb, type RunningWeb } from './web.js';

// The web app the end-to-end tests start: a run that is killed must not keep
// the next run from starting its own (#514).

/** Nothing listens here: the sign-in page needs no server to answer. */
const NO_SERVER_URL = 'http://127.0.0.1:9';

/** Two starts of next dev, each compiling the sign-in page. */
const TWO_STARTS_MS = 400_000;

/** Starts the web app in this file's own child process: a test run. */
const TEST_RUN = `
const { startWeb } = await import(process.env.WEB_MODULE);
await startWeb({ url: process.env.WEB_URL, serverUrl: process.env.SERVER_URL });
console.log('serving');
setInterval(() => {}, 60_000);
`;

const leftBehind: number[] = [];
let web: RunningWeb | undefined;

afterAll(async () => {
  await web?.stop();
  for (const pid of leftBehind) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Already gone: nothing was left behind.
    }
  }
});

/** A test run that started the web app, then was killed at once, as a killed npm test is. */
async function killedRun(): Promise<void> {
  const run = spawn(process.execPath, ['--input-type=module', '--eval', TEST_RUN], {
    env: {
      ...process.env,
      WEB_MODULE: new URL('web.ts', import.meta.url).href,
      WEB_URL: await reserveWebUrl(),
      SERVER_URL: NO_SERVER_URL,
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let output = '';
  run.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  while (!output.includes('serving')) {
    if (run.exitCode !== null) {
      throw new Error(`the test run exited with ${String(run.exitCode)}:\n${output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const { stdout } = await promisify(execFile)('pgrep', ['-P', String(run.pid)]);
  leftBehind.push(...stdout.split('\n').filter(Boolean).map(Number));
  run.kill('SIGKILL');
  await once(run, 'exit');
}

describe('the web app of the end-to-end tests', () => {
  it(
    'starts its own after a killed test run, which leaves no next dev behind',
    async () => {
      await killedRun();

      web = await startWeb({ url: await reserveWebUrl(), serverUrl: NO_SERVER_URL });

      expect((await fetch(`${web.url}/sign-in`)).ok).toBe(true);
    },
    TWO_STARTS_MS,
  );
});
