import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { inject } from 'vitest';

import { createPrismaClient } from '../../src/adapters/prisma/client.js';

const run = promisify(execFile);
const serverRoot = fileURLToPath(new URL('../..', import.meta.url));
const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');

/** Runs the Prisma CLI from the server package against the given database. */
export function prisma(databaseUrl: string, ...args: string[]): Promise<{ stdout: string; stderr: string }> {
  return run(process.execPath, [prismaCli, ...args], {
    cwd: serverRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}

/** Creates an empty database in the shared Postgres container and returns its URL. */
export async function createEmptyDatabase(): Promise<string> {
  const adminUrl = inject('postgresUrl');
  const name = `aeolus_test_${randomBytes(6).toString('hex')}`;

  const admin = createPrismaClient(adminUrl);
  try {
    // The name is generated above, never outside input.
    await admin.$executeRawUnsafe(`CREATE DATABASE ${name}`);
  } finally {
    await admin.$disconnect();
  }

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

/** Creates a database and applies the committed migrations with `prisma migrate deploy`. */
export async function createMigratedDatabase(): Promise<string> {
  const databaseUrl = await createEmptyDatabase();
  await prisma(databaseUrl, 'migrate', 'deploy');
  return databaseUrl;
}
