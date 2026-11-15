/** The plain payloads' partial index is built while core serves, never in a startup migration (decision 0068, #1854). */
import pg from 'pg';
import { z } from 'zod';

const CONNECTION_WAIT_MS = 10_000;

/** Returns false while another core builds it. A disconnected build's invalid index is removed before retrying. */
export async function ensureMessagesPlainPayloadIndex(databaseUrl: string): Promise<boolean> {
  // Concurrent DDL cannot run in a transaction. One connection holds the
  // session lock through inspection and building; closing it releases the lock.
  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: CONNECTION_WAIT_MS });
  try {
    await client.connect();
    const { rows: locks } = await client.query("SELECT pg_try_advisory_lock(hashtext('aeolus-messages-plain-payload-index')) AS is_locked");
    if (!z.array(z.object({ is_locked: z.boolean() })).parse(locks)[0]?.is_locked) {
      return false;
    }
    const { rows } = await client.query("SELECT indisvalid AS is_valid FROM pg_index WHERE indexrelid = to_regclass('messages_plain_payload_idx')");
    const [index] = z.array(z.object({ is_valid: z.boolean() })).parse(rows);
    if (index?.is_valid === true) {
      return true;
    }
    if (index !== undefined) {
      await client.query('DROP INDEX CONCURRENTLY IF EXISTS messages_plain_payload_idx');
    }
    // The plain messages of a sealing fleet, oldest first: whether one is left
    // is read from it alone, never across the sealed ones. Until it is ready
    // the same read is correct, only slower.
    await client.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS messages_plain_payload_idx
      ON messages (fleet_id, created_at, id) WHERE payload IS NOT NULL`);
    return true;
  } finally {
    await client.end();
  }
}
