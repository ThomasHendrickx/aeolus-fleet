#!/usr/bin/env node
/**
 * `aeolus-console start`: serves the operator console, built when the package was
 * published, with the standalone server Next.js built (.next/standalone), which
 * needs no Next.js installed. Every setting comes from environment variables
 * (see the README): PORT, HOST and AEOLUS_SERVER_URL, the last read when the
 * app runs, never when it was built.
 */
import { spawn } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const USAGE = 'Usage: aeolus-console start';
const DEFAULT_PORT = '3000';
const DEFAULT_HOST = '127.0.0.1';

const [command, ...rest] = process.argv.slice(2);

if (command !== 'start' || rest.length > 0) {
  process.stderr.write(`${USAGE}\n`);
  process.exit(2);
}

const server = fileURLToPath(new URL('../.next/standalone/packages/console/server.js', import.meta.url));
const port = process.env.PORT || DEFAULT_PORT;
const host = process.env.HOST || DEFAULT_HOST;
const child = spawn(process.execPath, [server], {
  stdio: 'inherit',
  // The standalone server listens on HOSTNAME, which a shell or container
  // often sets to the machine's name: HOST decides it. The console never
  // reports to Next.js's telemetry.
  env: { ...process.env, PORT: port, HOSTNAME: host, NEXT_TELEMETRY_DISABLED: '1' },
});

// A stop given to this process stops the web app too.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child.kill(signal);
  });
}
child.on('exit', (code, signal) => {
  process.exit(code ?? (signal === null ? 1 : 0));
});
