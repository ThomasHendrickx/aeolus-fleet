import { createPrismaClient, type Db } from '../../src/adapters/prisma/client.js';

/** The advisory lock Prisma Migrate holds on a database while it migrates. */
const PRISMA_MIGRATE_LOCK = 72_707_369;

/** Longer than Prisma Migrate itself waits for its lock (10 seconds). */
const LONG_MIGRATION_MS = 12_000;

/** How often to look whether the migrate waits for the lock. */
const POLL_MS = 100;

export interface WaitedMigrate<T> {
  outcome: T;
  releasedAt: number;
  finishedAt: number;
}

/**
 * Holds Prisma Migrate's lock on the database as a long migrate in progress
 * does: starts `migrate`, holds the lock until it has waited for it longer
 * than Prisma's own wait, then lets go. Says when it let go and when the
 * migrate finished.
 */
export async function migrateWhileAnotherHoldsTheLock<T>(databaseUrl: string, migrate: () => Promise<T>): Promise<WaitedMigrate<T>> {
  const database = createPrismaClient(databaseUrl);
  let migrating: Promise<{ outcome: T; finishedAt: number }> | undefined;
  try {
    await database.$transaction(
      async (inProgress) => {
        await inProgress.$executeRaw`SELECT pg_advisory_xact_lock(${PRISMA_MIGRATE_LOCK})`;
        migrating = migrate().then((outcome) => ({ outcome, finishedAt: Date.now() }));
        // Awaited below, once the lock is let go; a failure surfaces there.
        migrating.catch(() => undefined);
        await waitForLockWaiter(inProgress);
        await new Promise((resolve) => setTimeout(resolve, LONG_MIGRATION_MS));
      },
      { timeout: 60_000 },
    );
  } finally {
    await database.$disconnect();
  }
  const releasedAt = Date.now();
  if (migrating === undefined) {
    throw new Error('the migrate never started');
  }
  return { ...(await migrating), releasedAt };
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
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}
