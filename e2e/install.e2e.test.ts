import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { OPERATOR } from '../packages/server/test/support/core-fixtures.js';
import { createEmptyDatabase } from '../packages/server/test/support/database.js';
import { signIn } from './support/console.js';
import { freePort, launchChromium } from './support/web.js';

// The packages as an operator gets them from npm: built, packed, installed
// from the tarballs in an empty folder, and run only through their bin
// commands, with every setting from environment variables. Nothing here
// reaches into the repository's source. The web app was built without
// knowing where the server runs; the browser still finds it.

const run = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

/** Building the web app and installing from the registry take a while. */
const SETUP_TIMEOUT_MS = 600_000;
const ANSWER_TIMEOUT_MS = 60_000;

/** Nothing of the developer's shell or .env: only what finds node and npm, and the settings given. */
function cleanEnvironment(settings: Record<string, string>): Record<string, string> {
  const { PATH = '', HOME = '' } = process.env;
  return { PATH, HOME, NEXT_TELEMETRY_DISABLED: '1', ...settings };
}

let installFolder: string;
let databaseUrl: string;
let serverUrl: string;
let webUrl: string;
let browser: Browser | undefined;
const running: ChildProcess[] = [];

/** An installed bin command: its name, its arguments and its settings. */
interface BinCall {
  bin: string;
  args: string[];
  env: Record<string, string>;
}

/** Runs an installed bin command to its end, with the answers on standard input. */
async function runBin(
  call: BinCall,
  answers: string[] = [],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(join(installFolder, 'node_modules', '.bin', call.bin), call.args, {
    cwd: installFolder,
    env: cleanEnvironment(call.env),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  child.stdin.end(answers.map((answer) => `${answer}\n`).join(''));
  const code = await new Promise<number | null>((resolve) => {
    child.once('close', resolve);
  });
  return { code, stdout, stderr };
}

/** Starts an installed bin command that keeps running, and keeps what it writes for when it fails. */
function startBin(call: BinCall): { output: () => string } {
  const child = spawn(join(installFolder, 'node_modules', '.bin', call.bin), call.args, {
    cwd: installFolder,
    env: cleanEnvironment(call.env),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  running.push(child);
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
  return { output: () => output };
}

/** The status /health answers, or undefined while nothing listens. */
async function healthStatus(url: string): Promise<number | undefined> {
  const response = await fetch(`${url}/health`).catch(() => undefined);
  return response?.status;
}

beforeAll(async () => {
  await run('npm', ['run', 'build'], { cwd: repositoryRoot, env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });

  const tarballs = await mkdtemp(join(tmpdir(), 'aeolus-tarballs-'));
  await run(
    'npm',
    [
      'pack',
      '--pack-destination',
      tarballs,
      '--workspace',
      '@aeolus-fleet/common',
      '--workspace',
      '@aeolus-fleet/server',
      '--workspace',
      '@aeolus-fleet/web',
    ],
    { cwd: repositoryRoot },
  );
  const packed = (await readdir(tarballs)).filter((name) => name.endsWith('.tgz')).map((name) => join(tarballs, name));
  expect(packed).toHaveLength(3);

  // Common from its tarball too: npm would otherwise take the 0.0.0 placeholder from the registry.
  installFolder = await mkdtemp(join(tmpdir(), 'aeolus-install-'));
  await writeFile(join(installFolder, 'package.json'), JSON.stringify({ name: 'fleet-host', private: true }));
  await run('npm', ['install', '--no-audit', '--no-fund', ...packed], {
    cwd: installFolder,
    env: cleanEnvironment({}),
  });

  databaseUrl = await createEmptyDatabase();
  const serverPort = await freePort();
  const webPort = await freePort();
  // Both under localhost: one site, so the browser's session cookie goes along to the server.
  serverUrl = `http://localhost:${String(serverPort)}`;
  webUrl = `http://localhost:${String(webPort)}`;
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await browser?.close();
  for (const child of running) {
    child.kill('SIGTERM');
  }
  await Promise.all(running.filter((child) => child.exitCode === null).map((child) => once(child, 'exit')));
  await rm(installFolder, { recursive: true, force: true });
});

describe('installed from npm', () => {
  it('migrates the database with aeolus-server migrate', async () => {
    const result = await runBin({ bin: 'aeolus-server', args: ['migrate'], env: { DATABASE_URL: databaseUrl } });

    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
  });

  it('initialises the fleet with aeolus-server fleet:init', async () => {
    const result = await runBin(
      {
        bin: 'aeolus-server',
        args: ['fleet:init', '--name', 'home fleet'],
        env: { DATABASE_URL: databaseUrl, PUBLIC_URL: serverUrl },
      },
      [OPERATOR.email, OPERATOR.password, OPERATOR.password],
    );

    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Fleet initialised: flt_');
  });

  it('starts the server with aeolus-server start, and its /health answers the database up', async () => {
    const server = startBin({
      bin: 'aeolus-server',
      args: ['start'],
      env: { DATABASE_URL: databaseUrl, PUBLIC_URL: serverUrl, PORT: new URL(serverUrl).port, CONSOLE_ORIGIN: webUrl },
    });

    await expect
      .poll(() => healthStatus(serverUrl), { timeout: ANSWER_TIMEOUT_MS, interval: 500, message: server.output() })
      .toBe(200);
    await expect(fetch(`${serverUrl}/health`).then((response) => response.json())).resolves.toEqual({
      server: 'up',
      database: 'up',
    });
  });

  it('starts the web app with aeolus-web start, and its /health answers the server up', async () => {
    const web = startBin({
      bin: 'aeolus-web',
      args: ['start'],
      env: { PORT: new URL(webUrl).port, AEOLUS_SERVER_URL: serverUrl },
    });

    await expect
      .poll(() => healthStatus(webUrl), { timeout: ANSWER_TIMEOUT_MS, interval: 500, message: web.output() })
      .toBe(200);
    await expect(fetch(`${webUrl}/health`).then((response) => response.json())).resolves.toEqual({
      web: 'up',
      server: 'up',
      database: 'up',
    });
  });

  it('signs the operator in: the browser calls the server at the address the web app started with', async () => {
    browser = await launchChromium();
    const page = await browser.newPage({ baseURL: webUrl });

    await signIn(page, OPERATOR);

    await page.waitForURL(`${webUrl}/`);
    await page.getByRole('heading', { name: 'Fleet overview' }).waitFor();
  });
});
