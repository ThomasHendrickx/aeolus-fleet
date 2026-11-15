/** The first snapshot's event time ranges are indexed while core serves, never in a startup migration. */
import { ensureIndexAfterStart } from './index-after-start.js';

/** Returns false while another core builds it, or once `signal` stopped the build. */
export async function ensureHealthBootstrapIndex(databaseUrl: string, signal: AbortSignal = new AbortController().signal): Promise<boolean> {
  return ensureIndexAfterStart({
    name: 'events_delivery_bootstrap_idx',
    // Events accumulate by time. BRIN skips old heap ranges even when the
    // catch-up window is too broad for the ordinary time index to be cheaper than a scan.
    create: `
      CREATE INDEX CONCURRENTLY IF NOT EXISTS events_delivery_bootstrap_idx
      ON events USING brin (fleet_id, occurred_at)
      WITH (autosummarize=on) WHERE delivery_id IS NOT NULL`,
  }, { databaseUrl, signal });
}
