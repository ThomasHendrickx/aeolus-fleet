/** An index core builds while it serves, never in a startup migration. */
import pg from 'pg';
import { z } from 'zod';

import { CONNECTION_WAIT_MS } from './client.js';

export interface IndexAfterStart {
  /** The index's name, also the key of the session advisory lock that keeps two cores' builds apart. */
  name: string;
  /** Its `CREATE INDEX CONCURRENTLY IF NOT EXISTS` statement. */
  create: string;
}

/**
 * Builds the index unless a valid one exists, removing an invalid one first:
 * the one a build cut off by a stop or a failure leaves. Returns false while
 * another core builds it, or when `signal` aborts: that cancels the statement
 * running on its connection, so a stop never waits for a build.
 */
export async function ensureIndexAfterStart(index: IndexAfterStart, { databaseUrl, signal }: { databaseUrl: string; signal: AbortSignal }): Promise<boolean> {
  // Concurrent DDL cannot run in a transaction. One connection holds the
  // session lock through inspection and building; closing it releases the lock.
  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: CONNECTION_WAIT_MS });
  let backendPid: number | undefined;
  let cancelling: Promise<void> = Promise.resolve();
  const cancel = () => {
    if (backendPid !== undefined) {
      cancelling = cancelBackend(databaseUrl, backendPid);
    }
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    await client.connect();
    const { rows: pids } = await client.query('SELECT pg_backend_pid() AS pid');
    backendPid = z.array(z.object({ pid: z.number() })).parse(pids)[0]?.pid;
    // A statement is sent in the same tick as this check, before any cancel
    // can reach the server; an abort after it cancels that statement.
    const run = async (sql: string, values: unknown[] = []) => {
      if (signal.aborted) {
        throw new IndexBuildStopped();
      }
      return client.query(sql, values);
    };
    const { rows: locks } = await run('SELECT pg_try_advisory_lock(hashtext($1)) AS is_locked', [index.name]);
    if (!z.array(z.object({ is_locked: z.boolean() })).parse(locks)[0]?.is_locked) {
      return false;
    }
    const { rows } = await run('SELECT indisvalid AS is_valid FROM pg_index WHERE indexrelid = to_regclass($1)', [index.name]);
    const [existing] = z.array(z.object({ is_valid: z.boolean() })).parse(rows);
    if (existing?.is_valid === true) {
      return true;
    }
    if (existing !== undefined) {
      await run(`DROP INDEX CONCURRENTLY IF EXISTS ${index.name}`);
    }
    await run(index.create);
    return true;
  } catch (error) {
    if (signal.aborted) {
      return false;
    }
    throw error;
  } finally {
    signal.removeEventListener('abort', cancel);
    await cancelling;
    await client.end();
  }
}

class IndexBuildStopped extends Error {}

/** Cancels the statement the backend runs, from a connection of its own. */
async function cancelBackend(databaseUrl: string, pid: number): Promise<void> {
  const canceller = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: CONNECTION_WAIT_MS });
  try {
    await canceller.connect();
    await canceller.query('SELECT pg_cancel_backend($1)', [pid]);
  } catch {
    // Closing the build's connection ends the build too, only later.
  } finally {
    await canceller.end();
  }
}
