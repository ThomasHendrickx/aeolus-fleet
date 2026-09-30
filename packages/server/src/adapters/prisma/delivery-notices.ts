import pg from 'pg';

import type { DeliveryNotice, Notifier } from '../../core/messaging/ports.js';
import type { Db } from './client.js';
import { toDeliveryNotice } from './rows.js';

/**
 * Wakes receivers with Postgres LISTEN/NOTIFY (ADR 0003). A send notifies on
 * one channel inside its transaction; Postgres hands the notice to listeners
 * only when that transaction commits, and drops it when it rolls back. The
 * payload says which delivery is pending and for whom, never the message's
 * payload.
 */
export const DELIVERY_PENDING_CHANNEL = 'aeolus_delivery_pending';

export function createPrismaNotifier(db: Db): Notifier {
  return {
    deliveryPending: async (notice) => {
      await db.$executeRaw`SELECT pg_notify(${DELIVERY_PENDING_CHANNEL}, ${JSON.stringify(notice)})`;
    },
  };
}

export interface DeliveryListener {
  close(): Promise<void>;
}

/**
 * Listens for pending deliveries on a connection of its own: LISTEN needs one
 * that no pool hands to another query, and it must be direct, not through a
 * transaction pooler. A long-poll receive waits on it (slice 5).
 */
export async function listenForPendingDeliveries(options: {
  databaseUrl: string;
  onNotice: (notice: DeliveryNotice) => void;
}): Promise<DeliveryListener> {
  const client = new pg.Client({ connectionString: options.databaseUrl });
  await client.connect();
  client.on('notification', ({ channel, payload }) => {
    if (channel === DELIVERY_PENDING_CHANNEL && payload !== undefined) {
      options.onNotice(toDeliveryNotice(JSON.parse(payload)));
    }
  });
  // The channel is the constant above, never outside input.
  await client.query(`LISTEN ${DELIVERY_PENDING_CHANNEL}`);
  return { close: () => client.end() };
}
