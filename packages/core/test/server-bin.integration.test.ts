import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { createPrismaClient, type Db } from '../src/adapters/prisma/client.js';
import { runServerCommand } from './support/commands.js';
import { FLEET_URL } from './support/core-fixtures.js';
import { createEmptyDatabase } from './support/database.js';

// `aeolus-core`, the one command an operator runs on the server: start,
// migrate, fleet:init and operator:reset-password. Run here as `npm run
// aeolus-core`, which runs the same entry from source.

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const migrationsFolder = fileURLToPath(new URL('../src/adapters/prisma/migrations', import.meta.url));

/** Every migration the package ships, by its folder's name. */
const MIGRATIONS = readdirSync(migrationsFolder, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

/** The advisory lock Prisma Migrate holds on a database while it migrates. */
const PRISMA_MIGRATE_LOCK = 72_707_369;

/** Longer than Prisma Migrate itself waits for its lock (10 seconds). */
const LONG_MIGRATION_MS = 12_000;

/** Long enough for a start that migrates first; a start that hangs fails well within the test's time. */
const START_TIMEOUT_MS = 20_000;

function aeolusServer(args: string[], env: Record<string, string>) {
  return runServerCommand({ script: 'aeolus-core', args, env });
}

/** The migrations the database records as applied, each as often as it was applied. */
async function appliedMigrations(databaseUrl: string): Promise<string[]> {
  const database = createPrismaClient(databaseUrl);
  try {
    const rows = await database.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name`;
    return rows.map((row) => row.migration_name);
  } finally {
    await database.$disconnect();
  }
}

/** Resolves once another session waits for Prisma Migrate's lock, which this one holds. */
async function waitForLockWaiter(holder: Db): Promise<void> {
  for (;;) {
    const [row] = await holder.$queryRaw<{ isWaiting: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_locks
        WHERE locktype = 'advisory' AND objid = ${PRISMA_MIGRATE_LOCK} AND NOT granted
          AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
      ) AS "isWaiting"`;
    if (row?.isWaiting === true) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function freePort(): Promise<number> {
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

const running: { kill(): void }[] = [];

afterEach(() => {
  for (const child of running.splice(0)) {
    child.kill();
  }
});

describe('aeolus-core migrate', () => {
  it('applies every migration to an empty database', async () => {
    const databaseUrl = await createEmptyDatabase();

    const result = await aeolusServer(['migrate'], { DATABASE_URL: databaseUrl });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('The database is migrated.');
    await expect(appliedMigrations(databaseUrl)).resolves.toEqual(MIGRATIONS);
  });

  it('applies nothing twice when run again', async () => {
    const databaseUrl = await createEmptyDatabase();
    await aeolusServer(['migrate'], { DATABASE_URL: databaseUrl });

    const again = await aeolusServer(['migrate'], { DATABASE_URL: databaseUrl });

    expect(again.code).toBe(0);
    await expect(appliedMigrations(databaseUrl)).resolves.toEqual(MIGRATIONS);
  });

  it('migrates once when two run at the same time: the advisory lock makes the second wait', async () => {
    const databaseUrl = await createEmptyDatabase();

    const results = await Promise.all([
      aeolusServer(['migrate'], { DATABASE_URL: databaseUrl }),
      aeolusServer(['migrate'], { DATABASE_URL: databaseUrl }),
    ]);

    expect(results.map((result) => result.code)).toEqual([0, 0]);
    await expect(appliedMigrations(databaseUrl)).resolves.toEqual(MIGRATIONS);
  });

  it('waits for a migrate in progress however long it takes, then finds the database to migrate', async () => {
    const databaseUrl = await createEmptyDatabase();
    const database = createPrismaClient(databaseUrl);
    let migrating: Promise<{ code: number; stderr: string }> | undefined;
    try {
      await database.$transaction(
        async (inProgress) => {
          await inProgress.$executeRaw`SELECT pg_advisory_xact_lock(${PRISMA_MIGRATE_LOCK})`;
          migrating = aeolusServer(['migrate'], { DATABASE_URL: databaseUrl });
          await waitForLockWaiter(inProgress);
          await new Promise((resolve) => setTimeout(resolve, LONG_MIGRATION_MS));
        },
        { timeout: 60_000 },
      );
    } finally {
      await database.$disconnect();
    }
    const releasedAt = Date.now();
    const result = await migrating;
    const finishedAt = Date.now();

    expect(result?.code, result?.stderr).toBe(0);
    expect(finishedAt).toBeGreaterThan(releasedAt);
    await expect(appliedMigrations(databaseUrl)).resolves.toEqual(MIGRATIONS);
  }, 90_000);

  it('needs only the database URL, and names it when it is missing', async () => {
    // Set, though empty: a developer's .env, which the npm script loads, never fills in a variable already set.
    const result = await aeolusServer(['migrate'], { DATABASE_URL: '' });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('DATABASE_URL');
  });
});

describe('aeolus-core start', () => {
  it('migrates an empty database first, then serves: /health answers the database up', async () => {
    const databaseUrl = await createEmptyDatabase();
    const port = await freePort();
    const child = spawn('npm', ['run', '--silent', 'aeolus-core', '-w', '@aeolus-fleet/core', '--', 'start'], {
      cwd: repositoryRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl, PUBLIC_URL: FLEET_URL, PORT: String(port), LOG_LEVEL: 'error' },
      stdio: 'ignore',
      detached: true,
    });
    // npm starts the server as a child of its own: end the whole group.
    running.push({ kill: () => process.kill(-(child.pid ?? 0), 'SIGTERM') });

    await expect
      .poll(
        async () => {
          const response = await fetch(`http://127.0.0.1:${String(port)}/health`).catch(() => undefined);
          return response?.status;
        },
        { timeout: START_TIMEOUT_MS, interval: 250 },
      )
      .toBe(200);
    await expect(appliedMigrations(databaseUrl)).resolves.toEqual(MIGRATIONS);
  });
});

describe('aeolus-core', () => {
  it('names its commands and exits 2 without one', async () => {
    const result = await aeolusServer([], {});

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Usage: aeolus-core start | migrate | fleet:init --name "<fleet name>" | operator:reset-password');
  });

  it('refuses a command it does not know, and exits 2', async () => {
    const result = await aeolusServer(['launch'], {});

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Usage: aeolus-core');
  });
});
