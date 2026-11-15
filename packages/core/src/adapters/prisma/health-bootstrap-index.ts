/** The first snapshot's event time ranges are indexed while core serves, never in a startup migration. */
import pg from 'pg';
import { z } from 'zod';

const CONNECTION_WAIT_MS = 10_000;

/** Returns false while another core builds it. A disconnected build's invalid index is removed before retrying. */
export async function ensureHealthBootstrapIndex(databaseUrl: string): Promise<boolean> {
  // Concurrent DDL cannot run in a transaction. One connection holds the
  // session lock through inspection and building; closing it releases the lock.
  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: CONNECTION_WAIT_MS });
  try {
    await client.connect();
    const { rows: locks } = await client.query("SELECT pg_try_advisory_lock(hashtext('aeolus-health-bootstrap-index')) AS is_locked");
    if (!z.array(z.object({ is_locked: z.boolean() })).parse(locks)[0]?.is_locked) {
      return false;
    }
    const { rows } = await client.query("SELECT indisvalid AS is_valid FROM pg_index WHERE indexrelid = to_regclass('events_delivery_bootstrap_idx')");
    const [index] = z.array(z.object({ is_valid: z.boolean() })).parse(rows);
    if (index?.is_valid === true) {
      return true;
    }
    if (index !== undefined) {
      await client.query('DROP INDEX CONCURRENTLY IF EXISTS events_delivery_bootstrap_idx');
    }
    // Events accumulate by time. BRIN skips old heap ranges even when the
    // catch-up window is too broad for the ordinary time index to be cheaper than a scan.
    await client.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS events_delivery_bootstrap_idx
      ON events USING brin (fleet_id, occurred_at)
      WITH (autosummarize=on) WHERE delivery_id IS NOT NULL`);
    return true;
  } finally {
    await client.end();
  }
}
