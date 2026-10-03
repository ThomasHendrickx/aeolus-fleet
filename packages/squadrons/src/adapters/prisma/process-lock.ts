/**
 * One squadrons process per database (#86 (g)): two would share the flagships'
 * leases and overwrite each other's updates. A Postgres advisory lock, held by
 * a connection of its own for as long as the process runs, says which one runs.
 */
import pg from 'pg';

export interface ProcessLock {
  release(): Promise<void>;
}

/** The lock's key, the same for every squadrons process; advisory locks are per database. */
const LOCK_NAME = 'aeolus-squadrons';

/**
 * Takes the lock, or answers null when another process holds it. `onLost` is
 * called when the lock's connection fails, so the lock is gone; a process must
 * not go on without it.
 */
export async function acquireProcessLock(databaseUrl: string, options: { onLost: (error: Error) => void }): Promise<ProcessLock | null> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const { rows } = await client.query<{ isLocked: boolean }>('SELECT pg_try_advisory_lock(hashtext($1)) AS "isLocked"', [LOCK_NAME]);
  if (rows[0]?.isLocked !== true) {
    await client.end();
    return null;
  }
  let isReleased = false;
  client.on('error', (error) => {
    if (!isReleased) {
      options.onLost(error);
    }
  });
  return {
    release: async () => {
      isReleased = true;
      // Ending the session lets the lock go.
      await client.end();
    },
  };
}
